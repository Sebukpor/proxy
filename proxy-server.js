const express = require('express');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();

// Trust proxy (required for Render and rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS - Allow your local dev and production domains
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, curl, etc.)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'http://localhost:5500',
            'http://localhost:5501',
            'http://localhost:5502',
            'http://127.0.0.1:5500',
            'http://127.0.0.1:5501',
            'http://127.0.0.1:5502',
            'http://localhost:3000',
            'http://localhost:8080',
            'https://chestexpertprime.vercel.app',
            'platform.dasmedhub.com',
            'https://proxy-twjq.onrender.com'
        ];
        
        // Add any custom origins from env
        if (process.env.ALLOWED_ORIGINS) {
            const envOrigins = process.env.ALLOWED_ORIGINS.split(',');
            allowedOrigins.push(...envOrigins);
        }
        
        if (allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
            callback(null, true);
        } else {
            console.log('Blocked origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204
}));

// Handle preflight
app.options('*', cors());

// Rate limiting with trust proxy enabled
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        // Use X-Forwarded-For if available (Render sets this)
        return req.ip || req.headers['x-forwarded-for'] || 'unknown';
    }
});
app.use('/analyze', limiter);

// Body parsing for JSON
app.use(express.json());

// File upload configuration
const upload = multer({ 
    limits: { fileSize: 50 * 1024 * 1024 },
    storage: multer.memoryStorage()
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        cors: 'enabled',
        env: process.env.NODE_ENV || 'development'
    });
});

// Test endpoint
app.get('/test', (req, res) => {
    res.json({ message: 'Proxy is working!', cors: 'ok' });
});

// Proxy endpoint
app.post('/analyze', upload.single('image'), async (req, res) => {
    try {
        console.log('Received analyze request');
        console.log('File:', req.file?.originalname, 'Size:', req.file?.size);
        
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const formData = new FormData();
        formData.append('image', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype
        });

        if (req.body.context_json) {
            formData.append('context_json', req.body.context_json);
        }

        console.log('Forwarding to HF Space:', process.env.HF_SPACE_URL);

        const hfResponse = await axios.post(
            `${process.env.HF_SPACE_URL}/analyze`,
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    'Authorization': `Bearer ${process.env.HF_TOKEN}`
                },
                timeout: 120000,
                maxBodyLength: 100 * 1024 * 1024,
                maxContentLength: 100 * 1024 * 1024
            }
        );

        console.log('HF Response received');
        res.json(hfResponse.data);

    } catch (error) {
        console.error('Proxy error:', error.message);
        
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({ 
                error: 'Analysis timeout' 
            });
        }
        
        if (error.response) {
            return res.status(error.response.status).json({
                error: 'Analysis service error',
                details: error.response.data
            });
        }

        res.status(500).json({ 
            error: 'Internal server error'
        });
    }
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ 
        error: 'Internal server error'
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Proxy server running on port ${PORT}`);
    console.log(`HF Space: ${process.env.HF_SPACE_URL}`);
});

