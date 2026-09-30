const axios = require('axios');

const getApiUrl = () => {
  return process.env.PAYPAL_MODE === 'live' 
    ? 'https://api.paypal.com' 
    : 'https://api.sandbox.paypal.com';
};

const getAccessToken = async () => {
  try {
    const auth = Buffer.from(
      `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
    ).toString('base64');
    
    const response = await axios.post(
      `${getApiUrl()}/v1/oauth2/token`,
      'grant_type=client_credentials',
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    return response.data.access_token;
  } catch (error) {
    throw new Error('Error al obtener token de PayPal');
  }
};

const createOrder = async (amount, transactionId) => {
  try {
    const accessToken = await getAccessToken();
    
    const response = await axios.post(
      `${getApiUrl()}/v2/checkout/orders`,
      {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: transactionId,
            description: 'Recarga de Coins - BOT-API-Hosting',
            amount: {
              currency_code: 'USD',
              value: amount.toFixed(2)
            }
          }
        ],
        application_context: {
          brand_name: 'BOT-API-Hosting',
          landing_page: 'NO_PREFERENCE',
          user_action: 'PAY_NOW'
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data;
  } catch (error) {
    throw new Error('Error al crear orden de PayPal');
  }
};

const captureOrder = async (orderId) => {
  try {
    const accessToken = await getAccessToken();
    
    const response = await axios.post(
      `${getApiUrl()}/v2/checkout/orders/${orderId}/capture`,
      {},
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data;
  } catch (error) {
    throw new Error('Error al capturar pago de PayPal');
  }
};

const verifyWebhook = async (headers, body) => {
  try {
    const accessToken = await getAccessToken();
    
    const response = await axios.post(
      `${getApiUrl()}/v1/notifications/verify-webhook-signature`,
      {
        transmission_id: headers['paypal-transmission-id'],
        transmission_time: headers['paypal-transmission-time'],
        cert_url: headers['paypal-cert-url'],
        auth_algo: headers['paypal-auth-algo'],
        transmission_sig: headers['paypal-transmission-sig'],
        webhook_id: process.env.PAYPAL_WEBHOOK_ID,
        webhook_event: body
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.verification_status === 'SUCCESS';
  } catch (error) {
    return false;
  }
};

module.exports = {
  getAccessToken,
  createOrder,
  captureOrder,
  verifyWebhook
};