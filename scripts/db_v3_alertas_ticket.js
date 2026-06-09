const db = require("../data/db");

async function migrate() {
    try {
        console.log("Iniciando migração: Suporte a Tickets Manuais...");

        await db.query("ALTER TABLE alertas ADD COLUMN tipo_origem VARCHAR(20) DEFAULT 'AUTOMATICO' AFTER status");

        try { await db.query("ALTER TABLE alertas MODIFY id_sensor TINYINT NULL"); } catch (e) {}
        try { await db.query("ALTER TABLE alertas MODIFY valor_medido FLOAT NULL"); } catch (e) {}
        try { await db.query("ALTER TABLE alertas MODIFY limite_referencia FLOAT NULL"); } catch (e) {}
        try { await db.query("ALTER TABLE alertas MODIFY unidade VARCHAR(10) NULL"); } catch (e) {}

        console.log("Migração concluída com sucesso.");
        process.exit(0);
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log("Coluna 'tipo_origem' já existe.");
            process.exit(0);
        }
        console.error("Erro na migração:", e);
        process.exit(1);
    }
}

migrate();
