import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';

// Configurar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:8080',
  credentials: true
}));
app.use(express.json());

// Configurar MercadoPago
const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
  options: {
    timeout: 5000,
    idempotencyKey: 'abc'
  }
});

const preference = new Preference(client);
const payment = new Payment(client);

// Interfaces
interface Product {
  id: string;
  title: string;
  quantity: number;
  unit_price: number;
  currency_id: string;
}

interface CreatePreferenceRequest {
  items: Product[];
  payer?: {
    name?: string;
    email?: string;
    phone?: {
      number?: string;
    };
  };
}

// Rutas

// Ruta de prueba
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Backend funcionando correctamente',
    timestamp: new Date().toISOString()
  });
});

// Obtener public key para el frontend
app.get('/api/config', (req, res) => {
  res.json({
    publicKey: process.env.MERCADOPAGO_PUBLIC_KEY
  });
});

// Crear preferencia de pago
app.post('/api/create-preference', async (req, res) => {
  try {
    const { items, payer }: CreatePreferenceRequest = req.body;
    console.log('Datos recibidos para crear preferencia:', req.body);

    if (!items || items.length === 0) {
      return res.status(400).json({
        error: 'Items are required'
      });
    }

    const preferenceData = {
      items: items.map(item => ({
        id: item.id,
        title: item.title,
        quantity: item.quantity,
        unit_price: item.unit_price,
        currency_id: item.currency_id || 'PEN' // Para Perú
      })),
      payment_methods: {
        excluded_payment_methods: [],
        excluded_payment_types: [],
        installments: 12
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL}/success`,
        failure: `${process.env.FRONTEND_URL}/failure`,
        pending: `${process.env.FRONTEND_URL}/pending`
      },
      auto_return: 'approved' as const,
      payer: payer ? {
        name: payer.name,
        email: payer.email,
        phone: payer.phone
      } : undefined,
      notification_url: `${req.protocol}://${req.get('host')}/api/webhook`,
      statement_descriptor: 'MI_ECOMMERCE',
      external_reference: `order_${Date.now()}`
    };
    console.log('PreferenceData final:', preferenceData);
    const result = await preference.create({ body: preferenceData });


    res.json({
      id: result.id,
      init_point: result.init_point,
      sandbox_init_point: result.sandbox_init_point
    });

  } catch (error) {
    console.error('Error creating preference:', error);
    res.status(500).json({
      error: 'Error creating payment preference',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Webhook para recibir notificaciones de MercadoPago
app.post('/api/webhook', async (req, res) => {
  try {
    const { type, data } = req.body;

    console.log('Webhook received:', { type, data });

    if (type === 'payment') {
      const paymentId = data.id;
      
      // Obtener información del pago
      const paymentInfo = await payment.get({ id: paymentId });
      
      console.log('Payment info:', {
        id: paymentInfo.id,
        status: paymentInfo.status,
        external_reference: paymentInfo.external_reference,
        transaction_amount: paymentInfo.transaction_amount
      });

      // Aquí puedes actualizar tu base de datos según el estado del pago
      switch (paymentInfo.status) {
        case 'approved':
          console.log('Pago aprobado:', paymentId);
          // Actualizar orden como pagada
          break;
        case 'pending':
          console.log('Pago pendiente:', paymentId);
          // Mantener orden como pendiente
          break;
        case 'rejected':
          console.log('Pago rechazado:', paymentId);
          // Marcar orden como rechazada
          break;
      }
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Obtener información de un pago específico
app.get('/api/payment/:id', async (req, res) => {
  try {
    const paymentId = req.params.id;
    const paymentInfo = await payment.get({ id: paymentId });

    res.json({
      id: paymentInfo.id,
      status: paymentInfo.status,
      status_detail: paymentInfo.status_detail,
      transaction_amount: paymentInfo.transaction_amount,
      currency_id: paymentInfo.currency_id,
      payment_method_id: paymentInfo.payment_method_id,
      external_reference: paymentInfo.external_reference,
      date_created: paymentInfo.date_created
    });
  } catch (error) {
    console.error('Error getting payment info:', error);
    res.status(500).json({
      error: 'Error getting payment information',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Manejo de errores global
app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: error.message
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📱 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔑 Public Key: ${process.env.MERCADOPAGO_PUBLIC_KEY}`);
});

export default app;