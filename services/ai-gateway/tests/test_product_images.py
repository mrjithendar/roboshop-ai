import base64, io, sys, threading, unittest
from pathlib import Path
from types import SimpleNamespace
import mongomock
from PIL import Image
SERVICE = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(SERVICE), str(SERVICE / 'lib')]
import product_images
from admin import routes
from runtime import HttpError, error_details


def data_url(fmt='PNG', size=(640, 480), **save):
    output = io.BytesIO()
    Image.new('RGBA' if fmt == 'PNG' else 'RGB', size, (200, 30, 30, 255) if fmt == 'PNG' else (200, 30, 30)).save(output, format=fmt, **save)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(output.getvalue()).decode()


class ProductImageTests(unittest.TestCase):
    def setUp(self):
        self.db = mongomock.MongoClient().db
        self.store = SimpleNamespace(catalogue_lock=threading.RLock(), lock=threading.RLock(), reserved=lambda *a: 0, sold=lambda *a: 0)

    def upload(self, value, role='admin'):
        req = SimpleNamespace(user={'id': 'u1', 'role': role}, body=lambda maximum=16384: {'image': value})
        return product_images.upload(req, self.db)

    def save(self, image):
        body = {'sku': 'NEW', 'name': 'New', 'description': 'New', 'price': 10, 'instock': 2, 'categories': ['robot arms'], 'archived': False, 'image': image}
        req = SimpleNamespace(user={'id': 'u1', 'role': 'admin'}, path='/api/admin/products', method='POST', body=lambda: body)
        return routes(req, self.db, None, self.store)

    def test_upload_reencodes_to_bounded_jpeg_and_is_idempotent(self):
        result, status, _ = self.upload(data_url('PNG', (2400, 1200)))
        self.assertEqual(status, 201)
        self.assertRegex(result['image'], r'^/api/product-images/[0-9a-f]{32}\.jpg$')
        self.assertEqual((result['width'], result['height']), (1600, 800))
        content, code, headers = product_images.serve(result['image'], self.db)
        self.assertEqual(code, 200)
        self.assertIn(('Content-Type', 'image/jpeg'), headers)
        with Image.open(io.BytesIO(content)) as image:
            self.assertEqual(image.format, 'JPEG')
            self.assertFalse(image.info.get('exif'))
        again, _, _ = self.upload(data_url('PNG', (2400, 1200)))
        self.assertEqual(again['image'], result['image'])
        self.assertEqual(self.db.product_images.count_documents({}), 1)

    def test_rejects_unsupported_tiny_or_oversized_uploads_with_actionable_messages(self):
        for value in ['https://example.com/x.png', 'data:image/svg+xml;base64,PHN2Zz4=', data_url('GIF'), data_url('PNG', (64, 64)),
                      'data:image/png;base64,' + 'A' * product_images.MAX_UPLOAD_CHARS, 'data:image/png;base64,bm90IGFuIGltYWdl']:
            with self.assertRaises(HttpError) as raised:
                self.upload(value)
            self.assertTrue(raised.exception.public)
            self.assertNotIn('sensitive', error_details(raised.exception)['reason'])
        self.assertEqual(self.db.product_images.count_documents({}), 0)

    def test_customers_cannot_upload(self):
        with self.assertRaises(HttpError) as raised:
            self.upload(data_url(), role='customer')
        self.assertIn(raised.exception.status, (401, 403))

    def test_products_accept_only_uploaded_or_served_images(self):
        uploaded = self.upload(data_url())[0]['image']
        self.save(uploaded)
        self.assertEqual(self.db.products.find_one({'_id': 'NEW'})['image'], uploaded)
        for image in ['/api/product-images/' + '0' * 32 + '.jpg', '/product-media/never-served.webp', '/images/x.jpg']:
            self.db.products.delete_many({})
            with self.assertRaises(HttpError):
                self.save(image)

    def test_unknown_image_returns_404_and_other_paths_are_ignored(self):
        with self.assertRaises(HttpError) as raised:
            product_images.serve('/api/product-images/' + 'a' * 32 + '.jpg', self.db)
        self.assertEqual(raised.exception.status, 404)
        self.assertIsNone(product_images.serve('/api/product-images/../x.jpg', self.db))


if __name__ == '__main__':
    unittest.main()
