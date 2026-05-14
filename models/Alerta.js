const db = require("../data/db");

class Alerta {
    static async getLatestAlertTimestamp() {
        const [[alertas]] = await db.query(`SELECT MAX(disparado_em) AS ts FROM alertas`);
        const latest = alertas.ts ? new Date(alertas.ts) : new Date();
        const now = new Date();
        return latest > now ? latest : now;
    }

    static async getKPIs() {
        const anchor = await this.getLatestAlertTimestamp();

        // KPIs da última semana (baseado na âncora)
        // Filtra tempos de resposta absurdos (> 24h = 1440 min) causados por testes ou dados corrompidos
        const [kpis] = await db.query(`
            SELECT
                COUNT(*) AS total_alertas,
                AVG(
                    CASE WHEN atendimento_iniciado_em IS NOT NULL
                          AND TIMESTAMPDIFF(MINUTE, disparado_em, atendimento_iniciado_em) <= 1440
                    THEN TIMESTAMPDIFF(MINUTE, disparado_em, atendimento_iniciado_em)
                    END
                ) AS tempo_medio_resposta_min,
                AVG(TIMESTAMPDIFF(MINUTE, disparado_em, normalizado_em)) AS tempo_medio_resolucao_min,
                CASE 
                    WHEN COUNT(*) > 0 THEN
                        (SUM(CASE WHEN atendimento_iniciado_em IS NOT NULL
                                  AND TIMESTAMPDIFF(MINUTE, disparado_em, atendimento_iniciado_em) <= 15
                            THEN 1 ELSE 0 END) / COUNT(*)) * 100
                    ELSE 0 
                END AS pct_resposta_no_sla
            FROM alertas
            WHERE disparado_em >= DATE_SUB(?, INTERVAL 7 DAY)
        `, [anchor]);

        // Semana anterior para calcular variação (8 a 14 dias atrás da âncora)
        const [kpisAnterior] = await db.query(`
            SELECT AVG(
                CASE WHEN atendimento_iniciado_em IS NOT NULL
                      AND TIMESTAMPDIFF(MINUTE, disparado_em, atendimento_iniciado_em) <= 1440
                THEN TIMESTAMPDIFF(MINUTE, disparado_em, atendimento_iniciado_em)
                END
            ) AS tempo_medio
            FROM alertas
            WHERE disparado_em BETWEEN DATE_SUB(?, INTERVAL 14 DAY) AND DATE_SUB(?, INTERVAL 7 DAY)
        `, [anchor, anchor]);

        // Setores com alerta CRITICO aberto agora
        const [setoresCriticos] = await db.query(`
            SELECT DISTINCT st.nome_setor
            FROM alertas a
            JOIN setores st ON st.id_setor = a.id_setor
            WHERE a.severidade = 'CRITICO' AND a.status = 'ABERTO'
        `);

        const tmAtual    = Number(kpis[0].tempo_medio_resposta_min) || 0;
        const tmAnterior = Number(kpisAnterior[0].tempo_medio)       || 0;
        const variacao   = tmAnterior ? (((tmAtual - tmAnterior) / tmAnterior) * 100).toFixed(1) : 0;

        return {
            total_alertas:            kpis[0].total_alertas,
            tempo_medio_resposta_min: parseFloat(tmAtual.toFixed(1)),
            tempo_medio_resolucao_min: parseFloat(Number(kpis[0].tempo_medio_resolucao_min || 0).toFixed(1)),
            pct_resposta_no_sla:      parseFloat(Number(kpis[0].pct_resposta_no_sla || 0).toFixed(1)),
            variacao_resposta_pct:    parseFloat(variacao),
            setores_criticos:         setoresCriticos.map(r => r.nome_setor),
        };
    }

    static async getHistorico() {
        const anchor = await this.getLatestAlertTimestamp();

        const [rows] = await db.query(`
            SELECT
                DATE_FORMAT(disparado_em,'%d/%m') AS dia,
                COUNT(*) AS total_disparados,
                SUM(CASE WHEN status = 'RESOLVIDO' THEN 1 ELSE 0 END) AS total_resolvidos
            FROM alertas
            WHERE disparado_em >= DATE_SUB(?, INTERVAL 7 DAY)
            GROUP BY DATE(disparado_em)
            ORDER BY DATE(disparado_em)
        `, [anchor]);
        return rows;
    }

    static async listar(filtros = {}) {
        const { severidade, status, id_setor } = filtros;

        let where = "WHERE 1=1";
        const params = [];
        if (severidade) { where += " AND a.severidade = ?"; params.push(severidade); }
        if (status)     { where += " AND a.status = ?";     params.push(status); }
        if (id_setor)   { where += " AND a.id_setor = ?";   params.push(id_setor); }

        const [rows] = await db.query(`
            SELECT
                a.id_alerta, a.id_setor,
                a.parametro, a.valor_medido, a.limite_referencia, a.unidade,
                a.severidade, a.status,
                DATE_FORMAT(a.disparado_em,'%d/%m %H:%i:%s') AS data_hora,
                TIMESTAMPDIFF(MINUTE, a.disparado_em, IFNULL(a.atendimento_iniciado_em, NOW())) AS minutos_ate_atendimento,
                TIMESTAMPDIFF(MINUTE, a.disparado_em, NOW()) AS minutos_desde_disparo,
                st.nome_setor,
                a.descricao,
                eq.nome AS nome_responsavel,
                eq.cargo AS cargo_responsavel
            FROM alertas a
            JOIN setores st ON st.id_setor = a.id_setor
            LEFT JOIN equipe eq ON eq.id_profissional = a.id_profissional_responsavel
            ${where}
            ORDER BY a.disparado_em DESC
            LIMIT 50
        `, params);

        return rows;
    }

    static async transferir(idAlerta, idProfissional) {
        await db.query(`
            UPDATE alertas 
            SET id_profissional_responsavel = ?, 
                status = CASE WHEN status = 'ABERTO' THEN 'EM_ATENDIMENTO' ELSE status END,
                atendimento_iniciado_em = IFNULL(atendimento_iniciado_em, NOW())
            WHERE id_alerta = ?
        `, [idProfissional, idAlerta]);
    }
}

module.exports = Alerta;
