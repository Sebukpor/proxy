const express = require('express');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: ['POST', 'GET', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // limit each IP to 50 requests per windowMs
    message: 'Too many requests, please try again later.'
});
app.use('/analyze', limiter);

// File upload configuration
const upload = multer({ 
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    storage: multer.memoryStorage()
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Proxy endpoint for image analysis
app.post('/analyze', upload.single('image'), async (req, res) => {
    try {
        // Validate required fields
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        // Prepare form data for HF Space
        const formData = new FormData();
        formData.append('image', req.file.buffer, {
            filename: req.file.originalname,
            contentType: req.file.mimetype
        });

        // Forward context_json if provided
        if (req.body.context_json) {
            formData.append('context_json', req.body.context_json);
        }

        // Call private HF Space with token
        const hfResponse = await axios.post(
            `${process.env.HF_SPACE_URL}/analyze`,
            formData,
            {
                headers: {
                    ...formData.getHeaders(),
                    'Authorization': `Bearer ${process.env.HF_TOKEN}`
                },
                timeout: 120000, // 2 minute timeout
                maxBodyLength: 100 * 1024 * 1024,
                maxContentLength: 100 * 1024 * 1024
            }
        );

        // Return HF Space response
        res.json(hfResponse.data);

    } catch (error) {
        console.error('Proxy error:', error.message);
        
        // Handle specific error types
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({ 
                error: 'Analysis timeout - the AI model took too long to respond' 
            });
        }
        
        if (error.response) {
            // HF Space returned an error
            return res.status(error.response.status).json({
                error: 'Analysis service error',
                details: error.response.data
            });
        }

        res.status(500).json({ 
            error: 'Internal server error',
            message: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ 
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Proxy server running on port ${PORT}`);
    console.log(`HF Space: ${process.env.HF_SPACE_URL}`);
});