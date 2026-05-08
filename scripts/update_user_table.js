const pool = require("../data/db");

async function updateTable() {
    try {
        const columns = [
            "ALTER TABLE usuario ADD COLUMN telefone VARCHAR(20)",
            "ALTER TABLE usuario ADD COLUMN cargo VARCHAR(100)",
            "ALTER TABLE usuario ADD COLUMN foto VARCHAR(255)"
        ];

        for (const sql of columns) {
            try {
                await pool.query(sql);
                console.log(`Sucesso: ${sql}`);
            } catch (e) {
                if (e.code === 'ER_DUP_FIELDNAME') {
                    console.log(`Coluna já existe: ${sql.split(" ").pop()}`);
                } else {
                    throw e;
                }
            }
        }
        process.exit(0);
    } catch (error) {
        console.error("Erro ao atualizar tabela:", error);
        process.exit(1);
    }
}

updateTable();
