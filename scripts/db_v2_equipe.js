const db = require("../data/db");

async function migrate() {
    try {
        console.log("Iniciando migração: Tabela de Equipe e Responsáveis...");

        // 1. Criar tabela de equipe
        await db.query(`
            CREATE TABLE IF NOT EXISTS equipe (
                id_profissional INT PRIMARY KEY AUTO_INCREMENT,
                nome VARCHAR(100) NOT NULL,
                cargo VARCHAR(50),
                especialidade VARCHAR(50)
            )
        `);

        // 2. Popular equipe se estiver vazia
        const [rows] = await db.query("SELECT COUNT(*) as total FROM equipe");
        if (rows[0].total === 0) {
            await db.query(`
                INSERT INTO equipe (nome, cargo, especialidade) VALUES 
                ('Eng. Marcos Selmini', 'Engenharia Clínica', 'Manutenção'),
                ('Dra. Tatiana Terabayashi', 'Médico Plantonista', 'UTI'),
                ('Téc. Carlos Rafael das Neves', 'Manutenção Predial', 'Infraestrutura'),
                ('Enf. Jakov Surjan', 'Enfermagem', 'Gestão de Riscos')
            `);
        }

        // 3. Adicionar coluna em alertas se não existir
        try {
            await db.query("ALTER TABLE alertas ADD COLUMN id_profissional_responsavel INT NULL");
            await db.query("ALTER TABLE alertas ADD CONSTRAINT fk_alerta_profissional FOREIGN KEY (id_profissional_responsavel) REFERENCES equipe(id_profissional)");
        } catch (e) {
            // Ignora erro se a coluna já existir
        }

        console.log("Migração concluída com sucesso.");
        process.exit(0);
    } catch (e) {
        console.error("Erro na migração:", e);
        process.exit(1);
    }
}

migrate();
