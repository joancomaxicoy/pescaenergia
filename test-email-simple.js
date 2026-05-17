require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('Testing SMTP config...');
console.log('Host:', process.env.SERVIDOR_SMTP);
console.log('Port:', process.env.PUERTO_SMTP);
console.log('User:', process.env.SMTP_USER);

const transporter = nodemailer.createTransport({
    host: process.env.SERVIDOR_SMTP || 'smtp.gmail.com',
    port: parseInt(process.env.PUERTO_SMTP) || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER || 'app.pescaenergia@gmail.com',
        pass: process.env.SMTP_PASSWORD,
    },
});

transporter.verify()
    .then(() => console.log('✅ SMTP config correcta'))
    .catch(err => console.error('❌ Error SMTP:', err.message));