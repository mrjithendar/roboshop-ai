from pathlib import Path
import tempfile
import unittest
from publish_aws import publish

class PublishTests(unittest.TestCase):
    def test_replaces_wrong_command_and_preserves_backup(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d); source=p/'official'; dest=p/'bin/aws'; dest.parent.mkdir()
            source.write_text('#!/bin/sh\necho aws-cli/2.38.3\n'); source.chmod(0o755)
            dest.write_text('broken old pip entrypoint')
            publish(source,dest)
            self.assertEqual(dest.resolve(),source.resolve())
            backups=list(dest.parent.glob('aws-command-backup-*/aws'))
            self.assertEqual(len(backups),1)
            self.assertEqual(backups[0].read_text(),'broken old pip entrypoint')
            publish(source,dest)
            self.assertEqual(len(list(dest.parent.glob('aws-command-backup-*'))),1)
    def test_rejects_wrong_source_without_replacing(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d); source=p/'wrong'; dest=p/'aws'
            source.write_text('#!/bin/sh\necho unrelated-tool\n'); source.chmod(0o755)
            dest.write_text('preserve')
            with self.assertRaises(ValueError): publish(source,dest)
            self.assertEqual(dest.read_text(),'preserve')
    def test_preserves_existing_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d); source=p/'official'; dest=p/'aws'
            source.write_text('#!/bin/sh\necho aws-cli/2.38.3\n'); source.chmod(0o755)
            dest.symlink_to('missing-old-target')
            publish(source,dest)
            backup=next(p.glob('aws-command-backup-*')) / 'aws'
            self.assertTrue(backup.is_symlink())
            self.assertEqual(backup.readlink(),Path('missing-old-target'))

if __name__ == '__main__': unittest.main()
