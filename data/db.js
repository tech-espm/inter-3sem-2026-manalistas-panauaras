const mysql = require("mysql2/promise");
require("dotenv").config();

// Configura o Pool de Conexões do MySQL utilizando o dotenv
const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "root",
    database: process.env.DB_DATABASE || "sensores_db",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true // Facilita tratar os DateTims que vem do MySQL sem perder o timezone
});

module.exports = pool;
