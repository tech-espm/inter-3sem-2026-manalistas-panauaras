const pool = require("../data/db");

async function createTable() {
    try {
        const sql = `
            CREATE TABLE IF NOT EXISTS usuario (
                id_usuario BIGINT NOT NULL AUTO_INCREMENT,
                nome VARCHAR(100) NOT NULL,
                email VARCHAR(100) NOT NULL UNIQUE,
                senha VARCHAR(255) NOT NULL,
                PRIMARY KEY (id_usuario)
            ) ENGINE=InnoDB;
        `;
        await pool.query(sql);
        console.log("Tabela 'usuario' criada com sucesso!");
        process.exit(0);
    } catch (error) {
        console.error("Erro ao criar tabela:", error);
        process.exit(1);
    }
}

createTable();
