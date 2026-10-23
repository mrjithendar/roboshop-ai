// Test-only transport injection: real Razorpay validation/signature code, no Internet.
import {startPaymentService} from '../../services/payment-service/server.mjs';
import {Razorpay} from '../../services/payment-service/razorpay.mjs';
const base=process.env.LOAD_MOCK_URL;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base||'') || process.env.PAYMENT_MODE!=='test') throw Error('Isolated test transport required');
startPaymentService(new Razorpay(process.env,(url,options)=>{
 if(!url.startsWith('https://api.razorpay.com/v1/'))throw Error('Unexpected provider destination');
 return fetch(base+url.slice('https://api.razorpay.com'.length),options);
}));
