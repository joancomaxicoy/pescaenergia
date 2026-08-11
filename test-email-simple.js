require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('Testing SMTP config...');

if (!process.env.SMTP_USER || !process.env.SMTP_PASSWORD) {
    throw new Error('SMTP_USER i SMTP_PASSWORD són obligatòries');
}

const transporter = nodemailer.createTransport({
    host: process.env.SERVIDOR_SMTP || 'smtp.gmail.com',
    port: parseInt(process.env.PUERTO_SMTP) || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
});

transporter.verify()
    .then(() => console.log('✅ SMTP config correcta'))
    .catch(err => console.error('❌ Error SMTP:', err.message));
