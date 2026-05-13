const express = require("express");
const router = express.Router();
const db = require("../data/db");
const wrap = require("express-async-error-wrapper");

// ============================================================
// HELPERS
// ============================================================

/** Retorna o limiar correto para um parâmetro num tipo de setor.
 *  Procura pelo tipo específico primeiro; cai em 'Geral' se não achar. */
async function getLimiar(tipo_setor, parametro) {
    const [rows] = await db.query(
        `SELECT limite_critico, limite_atencao FROM limiares_ambiente
         WHERE parametro = ? AND (tipo_setor = ? OR tipo_setor = 'Geral')
         ORDER BY FIELD(tipo_setor, ?, 'Geral') LIMIT 1`,
        [parametro, tipo_setor, tipo_setor]
    );
    return rows[0] || { limite_critico: 9999, limite_atencao: 9999 };
}

/** Calcula status ambiental baseado nos valores atuais vs limiares */
function calcStatus(co2, voc, limCO2Crit, limCO2Aten, limVOCCrit, limVOCAtencao) {
    if (co2 > limCO2Crit || voc > limVOCCrit) return "CRITICO";
    if (co2 > limCO2Aten || voc > limVOCAtencao) return "ATENCAO";
    return "NORMAL";
}

/**
 * Retorna o timestamp do dado mais recente disponível no banco.
 * Usado como âncora para todas as janelas temporais das queries,
 * garantindo que o dashboard sempre mostre dados mesmo que o scraper
 * esteja usando um delay (ex: 2 dias para trás).
 */
/**
 * Retorna o timestamp do dado mais recente disponível no banco.
 */
async function getLatestTimestamp() {
    const [[creative]] = await db.query(`SELECT MAX(data) AS ts FROM creative`);
    return creative.ts || new Date();
}

/**
 * Retorna o timestamp do alerta mais recente.
 */
async function getLatestAlertTimestamp() {
    const [[alertas]] = await db.query(`SELECT MAX(disparado_em) AS ts FROM alertas`);
    return alertas.ts || new Date();
}

// ============================================================
// ROTA 0: Lista de Setores (usada por dropdowns nas views)
// ============================================================
router.get("/setores", wrap(async (req, res) => {
    const [rows] = await db.query(
        `SELECT s.id_setor, s.nome_setor, s.tipo_setor, s.capacidade_maxima,
                COUNT(sen.id_sensor) AS total_sensores
         FROM setores s
         LEFT JOIN sensores sen ON sen.id_setor = s.id_setor AND sen.ativo = 1
         WHERE s.ativo = 1
         GROUP BY s.id_setor
         ORDER BY s.id_setor`
    );
    res.json(rows);
}));

// ============================================================
// ROTA 1: Resumo Ambiental Atual com variação percentual
//         Usado pelos KPI cards de tendencia.ejs
// ============================================================
router.get("/sensores/resumo", wrap(async (req, res) => {
    const anchor = await getLatestTimestamp();
    const [atual] = await db.query(`
        SELECT AVG(co2) co2, AVG(voc) voc, AVG(temperatura) temp, AVG(umidade) umidade,
               DATE_FORMAT(MAX(data),'%H:%i') hora_medicao
        FROM creative
        WHERE data >= DATE_SUB(?, INTERVAL 1 DAY)
    `, [anchor]);
    const [anterior] = await db.query(`
        SELECT AVG(co2) co2, AVG(voc) voc, AVG(temperatura) temp, AVG(umidade) umidade
        FROM creative
        WHERE data BETWEEN DATE_SUB(?, INTERVAL 2 DAY) AND DATE_SUB(?, INTERVAL 1 DAY)
    `, [anchor, anchor]);

    const a = atual[0];
    const b = anterior[0];

    function pct(v, p) {
        if (!p || p === 0) return 0;
        return (((v - p) / p) * 100).toFixed(1);
    }

    res.json({
        co2_media:         parseFloat((a.co2  || 0).toFixed(1)),
        voc_media:         parseFloat((a.voc  || 0).toFixed(1)),
        temp_media:        parseFloat((a.temp || 0).toFixed(1)),
        umidade_media:     parseFloat((a.umidade || 0).toFixed(1)),
        hora_medicao:      a.hora_medicao || "--",
        co2_variacao_pct:      parseFloat(pct(a.co2,      b.co2)),
        voc_variacao_pct:      parseFloat(pct(a.voc,      b.voc)),
        temp_variacao_pct:     parseFloat(pct(a.temp,     b.temp)),
        umidade_variacao_pct:  parseFloat(pct(a.umidade,  b.umidade)),
    });
}));

// ============================================================
// ROTA 2: Ocupação Atual (com suporte a ?id_setor=)
//         Usado por ocupacao.ejs
// ============================================================
router.get("/sensores/ocupacao", wrap(async (req, res) => {
    const id_setor = parseInt(req.query.id_setor) || 1;

    const [setor] = await db.query(
        `SELECT capacidade_maxima FROM setores WHERE id_setor = ?`,
        [id_setor]
    );
    const capacidade_maxima = setor[0] ? setor[0].capacidade_maxima : 25;

    // Pega o sensor PCA desse setor
    const [sensor] = await db.query(
        `SELECT id_sensor FROM sensores WHERE id_setor = ? AND tipo_sensor = 'HPD2' LIMIT 1`,
        [id_setor]
    );

    if (!sensor[0]) {
        return res.json({ pessoas_atuais: 0, capacidade_maxima, porcentagem: "0.0", hora_medicao: "--" });
    }

    const [rows] = await db.query(`
        SELECT pessoas, DATE_FORMAT(data,'%H:%i') AS hora_medicao
        FROM pca
        WHERE id_sensor = ?
        ORDER BY data DESC LIMIT 1
    `, [sensor[0].id_sensor]);

    const ocupacao = rows[0] ? rows[0].pessoas : 0;
    const porcentagem = ((ocupacao / capacidade_maxima) * 100).toFixed(1);

    res.json({
        pessoas_atuais:   ocupacao,
        capacidade_maxima,
        porcentagem:      parseFloat(porcentagem),
        hora_medicao:     rows[0] ? rows[0].hora_medicao : "--"
    });
}));

// ============================================================
// ROTA 3: Histórico de Ocupação (com suporte a ?id_setor=)
//         Gráfico de linha do ocupacao.ejs
// ============================================================
router.get("/graficos/ocupacao", wrap(async (req, res) => {
    const id_setor = parseInt(req.query.id_setor) || 1;

    const [sensor] = await db.query(
        `SELECT id_sensor FROM sensores WHERE id_setor = ? AND tipo_sensor = 'HPD2' LIMIT 1`,
        [id_setor]
    );
    if (!sensor[0]) return res.json([]);

    const [rows] = await db.query(`
        SELECT pessoas, delta, DATE_FORMAT(data,'%H:%i') AS hora
        FROM pca
        WHERE id_sensor = ?
        ORDER BY data DESC LIMIT 20
    `, [sensor[0].id_sensor]);

    res.json(rows.reverse());
}));

// ============================================================
// ROTA 4: Histórico Ambiental (CO2, VOC, Temp, Umidade)
//         Usado por ocupacao.ejs (correlação) e tendencia.ejs
// ============================================================
router.get("/graficos/ambiental", wrap(async (req, res) => {
    const periodo = req.query.periodo || "24h";
    let intervalHours;
    if (periodo === "7d")  intervalHours = 7 * 24;
    else if (periodo === "30d") intervalHours = 30 * 24;
    else intervalHours = 24;

    const anchor = await getLatestTimestamp();

    // Agrupa por hora para reduzir pontos e melhorar performance
    const [rows] = await db.query(`
        SELECT 
            AVG(co2) AS co2, AVG(voc) AS voc,
            AVG(temperatura) AS temp, AVG(umidade) AS humid,
            DATE_FORMAT(data,'%d/%m %H:%i') AS hora
        FROM creative
        WHERE data >= DATE_SUB(?, INTERVAL ${intervalHours} HOUR)
        GROUP BY DATE_FORMAT(data,'%Y-%m-%d %H')
        ORDER BY MIN(data)
    `, [anchor]);

    res.json(rows.map(r => ({
        co2:   parseFloat((r.co2   || 0).toFixed(1)),
        voc:   parseFloat((r.voc   || 0).toFixed(1)),
        temp:  parseFloat((r.temp  || 0).toFixed(1)),
        humid: parseFloat((r.humid || 0).toFixed(1)),
        hora:  r.hora
    })));
}));

// ============================================================
// ROTA 5: Dashboard Resumo (Score + Picos de CO2/VOC)
//         Usado pelo main_dash.ejs
// ============================================================
router.get("/dashboard/resumo", wrap(async (req, res) => {
    // Última leitura ambiental do único sensor Creative
    const [leituras] = await db.query(`
        SELECT co2, voc, temperatura, umidade, ruido,
               DATE_FORMAT(data,'%H:%i') AS hora
        FROM creative
        ORDER BY data DESC LIMIT 1
    `);
    const leitura = leituras[0] || { co2: 0, voc: 0, temperatura: 0, umidade: 0, ruido: 0 };

    // Score ambiental 0-100 (100 = perfeito, 0 = crítico)
    const scoreCO2 = Math.max(0, 1 - leitura.co2 / 1000);
    const scoreVOC = Math.max(0, 1 - leitura.voc / 400);
    const score = Math.round((scoreCO2 * 50) + (scoreVOC * 50));

    let status_geral = "NORMAL";
    if (leitura.co2 > 1000 || leitura.voc > 400) status_geral = "CRITICO";
    else if (leitura.co2 > 800 || leitura.voc > 250) status_geral = "ATENCAO";

    const anchor = await getLatestTimestamp();
    const [picoCO2] = await db.query(`
        SELECT st.nome_setor, MAX(c.co2) AS valor
        FROM creative c
        JOIN sensores s ON s.id_sensor = c.id_sensor
        JOIN setores st ON st.id_setor = s.id_setor
        WHERE c.data >= DATE_SUB(?, INTERVAL 1 DAY)
        GROUP BY st.nome_setor
        ORDER BY valor DESC LIMIT 1
    `, [anchor]);
    const [picoVOC] = await db.query(`
        SELECT st.nome_setor, MAX(c.voc) AS valor
        FROM creative c
        JOIN sensores s ON s.id_sensor = c.id_sensor
        JOIN setores st ON st.id_setor = s.id_setor
        WHERE c.data >= DATE_SUB(?, INTERVAL 1 DAY)
        GROUP BY st.nome_setor
        ORDER BY valor DESC LIMIT 1
    `, [anchor]);

    // Pico de Lotação na janela atual (sensor PCA)
    const [picoLotacao] = await db.query(`
        SELECT st.nome_setor, MAX(p.pessoas) AS valor
        FROM pca p
        JOIN sensores s ON s.id_sensor = p.id_sensor
        JOIN setores st ON st.id_setor = s.id_setor
        WHERE p.data >= DATE_SUB(?, INTERVAL 1 DAY)
        GROUP BY st.nome_setor
        ORDER BY valor DESC LIMIT 1
    `, [anchor]);

    // Sensores ativos
    const [sensoresAtivos] = await db.query(
        `SELECT COUNT(*) AS total FROM sensores WHERE ativo = 1`
    );

    res.json({
        score_ambiental: score,
        status_geral,
        co2_atual:         leitura.co2,
        voc_atual:         leitura.voc,
        temperatura_atual: leitura.temperatura,
        hora_medicao:      leitura.hora || "--",
        pico_co2_setor:    picoCO2[0] ? picoCO2[0].nome_setor : "N/D",
        pico_co2_valor:    picoCO2[0] ? picoCO2[0].valor.toFixed(0) : 0,
        pico_voc_setor:    picoVOC[0] ? picoVOC[0].nome_setor : "N/D",
        pico_voc_valor:    picoVOC[0] ? picoVOC[0].valor.toFixed(0) : 0,
        pico_lotacao_setor: picoLotacao[0] ? picoLotacao[0].nome_setor : "N/D",
        pico_lotacao_valor: picoLotacao[0] ? picoLotacao[0].valor : 0,
        sensores_ativos:   sensoresAtivos[0].total,
    });
}));

// ============================================================
// ROTA 6: Heatmap por Setor
//         Usado por main_dash.ejs (tiles dinâmicos)
// ============================================================
router.get("/dashboard/heatmap", wrap(async (req, res) => {
    const [setores] = await db.query(
        `SELECT id_setor, nome_setor, tipo_setor, capacidade_maxima FROM setores WHERE ativo = 1`
    );

    const resultado = await Promise.all(setores.map(async (setor) => {
        // Última leitura de ocupação para esse setor
        const [ultimaPca] = await db.query(`
            SELECT p.pessoas FROM pca p
            JOIN sensores s ON s.id_sensor = p.id_sensor
            WHERE s.id_setor = ? ORDER BY p.data DESC LIMIT 1
        `, [setor.id_setor]);

        // Última leitura de CO2 (vem sempre do sensor creative = setor 1)
        const [ultimaCreative] = await db.query(`
            SELECT co2, voc FROM creative ORDER BY data DESC LIMIT 1
        `);

        // Histórico de 6 leituras de CO2 (sparkline ancorado no último dado disponível)
        const heatmapAnchor = await getLatestTimestamp();
        const [historicoCO2] = await db.query(`
            SELECT AVG(co2) AS co2 FROM creative
            WHERE data >= DATE_SUB(?, INTERVAL 6 HOUR)
            GROUP BY DATE_FORMAT(data,'%Y-%m-%d %H')
            ORDER BY MIN(data) DESC LIMIT 6
        `, [heatmapAnchor]);

        // Alertas nas últimas 24h para esse setor
        const [alertas24h] = await db.query(`
            SELECT COUNT(*) AS total FROM alertas
            WHERE id_setor = ? AND disparado_em >= DATE_SUB(?, INTERVAL 1 DAY)
        `, [setor.id_setor, heatmapAnchor]);

        const co2 = ultimaCreative[0] ? ultimaCreative[0].co2 : 0;
        const voc = ultimaCreative[0] ? ultimaCreative[0].voc : 0;
        let status = "NORMAL";
        if (co2 > 1000 || voc > 400) status = "CRITICO";
        else if (co2 > 800 || voc > 250) status = "ATENCAO";

        // Buscar alertas ativos para este setor para saber quais parâmetros estão em risco
        const [alertasAtivos] = await db.query(`
            SELECT DISTINCT parametro FROM alertas 
            WHERE id_setor = ? AND status != 'RESOLVIDO'
        `, [setor.id_setor]);

        const parametrosEmRisco = alertasAtivos.map(a => a.parametro.toUpperCase());

        return {
            id_setor:         setor.id_setor,
            nome_setor:       setor.nome_setor,
            tipo_setor:       setor.tipo_setor,
            capacidade_maxima: setor.capacidade_maxima,
            pessoas_atuais:   ultimaPca[0] ? ultimaPca[0].pessoas : 0,
            co2_atual:        parseFloat((co2 || 0).toFixed(0)),
            voc_atual:        parseFloat((voc || 0).toFixed(0)),
            status,
            alertas_24h:      alertas24h[0].total,
            parametros_em_risco: parametrosEmRisco,
            historico:        historicoCO2.map(r => parseFloat((r.co2 || 0).toFixed(0))).reverse()
        };
    }));

    res.json(resultado);
}));

const Alerta = require("../models/Alerta");
const Equipe = require("../models/Equipe");

// ============================================================
// ROTA 7: Alertas com filtros opcionais
// ============================================================
router.get("/alertas", wrap(async (req, res) => {
    const rows = await Alerta.listar(req.query);
    res.json(rows);
}));

// ============================================================
// ROTA 7.1: Lista de Equipe
// ============================================================
router.get("/equipe", wrap(async (req, res) => {
    const rows = await Equipe.listar();
    res.json(rows);
}));

// ============================================================
// ROTA 7.2: Transferir Responsabilidade
// ============================================================
router.post("/alertas/:id/transferir", wrap(async (req, res) => {
    try {
        const idAlerta = parseInt(req.params.id, 10);
        if (isNaN(idAlerta)) {
            throw new Error(`ID do alerta inválido recebido pelo backend: ${req.params.id}`);
        }
        
        const { id_profissional } = req.body;
        console.log(`[API] Tentando transferir alerta ${idAlerta} para profissional ${id_profissional}`);
        await Alerta.transferir(idAlerta, id_profissional);
        res.json({ sucesso: true });
    } catch (e) {
        console.error("[API] Erro detalhado ao transferir:", e);
        res.status(500).json({ error: true, erro: e.message, stack: e.stack });
    }
}));

// ============================================================
// ROTA 8: KPIs de Alertas (SLA, tempo médio, setores críticos)
//         Usado pela central_alerta.ejs
// ============================================================
router.get("/alertas/kpis", wrap(async (req, res) => {
    const kpis = await Alerta.getKPIs();
    res.json(kpis);
}));

// ============================================================
// ROTA 9: Histórico de Alertas por Dia (7 dias)
//         Mini gráfico de barras da central_alerta.ejs
// ============================================================
router.get("/alertas/historico", wrap(async (req, res) => {
    const rows = await Alerta.getHistorico();
    res.json(rows);
}));

// ============================================================
// ROTA 10: Histórico do Sensor (em torno de um timestamp)
//          Gráfico de barras do detail panel em central_alerta.ejs
// ============================================================
router.get("/graficos/sensor", wrap(async (req, res) => {
    const id_sensor = parseInt(req.query.id_sensor) || 1;
    const timestamp = req.query.em_torno_de || null;

    let whereData = timestamp
        ? `AND data BETWEEN DATE_SUB('${timestamp}', INTERVAL 30 MINUTE) AND DATE_ADD('${timestamp}', INTERVAL 30 MINUTE)`
        : `AND data >= DATE_SUB(NOW(), INTERVAL 1 HOUR)`;

    const [rows] = await db.query(`
        SELECT co2, voc, temperatura, DATE_FORMAT(data,'%H:%i') AS hora
        FROM creative
        WHERE id_sensor = ? ${whereData}
        ORDER BY data
        LIMIT 30
    `, [id_sensor]);

    res.json(rows);
}));

// ============================================================
// ROTA 11: Eventos do Sensor PCA (com suporte a ?id_setor=)
//          Tabela de eventos da ocupacao.ejs
// ============================================================
router.get("/sensores/eventos", wrap(async (req, res) => {
    const id_setor = parseInt(req.query.id_setor) || 1;

    const [sensor] = await db.query(
        `SELECT id_sensor FROM sensores WHERE id_setor = ? AND tipo_sensor = 'HPD2' LIMIT 1`,
        [id_setor]
    );
    if (!sensor[0]) return res.json([]);

    const [rows] = await db.query(`
        SELECT pessoas, DATE_FORMAT(data,'%H:%i:%s') AS hora
        FROM pca
        WHERE id_sensor = ?
        ORDER BY data DESC LIMIT 12
    `, [sensor[0].id_sensor]);

    const [setor] = await db.query(
        `SELECT capacidade_maxima FROM setores WHERE id_setor = ?`,
        [id_setor]
    );
    const capacidade = setor[0] ? setor[0].capacidade_maxima : 25;

    const eventos = [];
    for (let i = 0; i < rows.length - 1; i++) {
        const diff = rows[i].pessoas - rows[i + 1].pessoas;
        if (diff !== 0) {
            const status = rows[i].pessoas >= (capacidade * 0.8) ? "ALERTA" : "NORMAL";
            eventos.push({
                hora:     rows[i].hora,
                evento:   diff > 0
                    ? `Entrada Detectada (${diff} pessoa${diff > 1 ? "s" : ""})`
                    : `Saída Detectada (${Math.abs(diff)} pessoa${Math.abs(diff) > 1 ? "s" : ""})`,
                ocupacao: `${rows[i].pessoas}/${capacidade}`,
                badge:    status === "ALERTA" ? "badge-warning" : "badge-success",
                status
            });
        }
    }

    if (eventos.length === 0 && rows.length > 0) {
        eventos.push({
            hora:     rows[0].hora,
            evento:   "Sem movimentação detectada",
            ocupacao: `${rows[0].pessoas}/${capacidade}`,
            badge:    "badge-success",
            status:   "NORMAL"
        });
    }

    res.json(eventos.slice(0, 6));
}));

// ============================================================
// ROTA 12: Compliance ANVISA (% de leituras dentro dos limites)
//          Tabela de compliance da tendencia.ejs
// ============================================================
router.get("/tendencia/compliance", wrap(async (req, res) => {
    const periodo = req.query.periodo || "24h";
    let interval;
    if (periodo === "7d")       interval = "7 DAY";
    else if (periodo === "30d") interval = "30 DAY";
    else                        interval = "1 DAY";

    const [rows] = await db.query(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN co2 <= 1000 THEN 1 ELSE 0 END) AS co2_ok,
            SUM(CASE WHEN voc <= 400  THEN 1 ELSE 0 END) AS voc_ok,
            SUM(CASE WHEN temperatura <= 26 AND temperatura >= 18 THEN 1 ELSE 0 END) AS temp_ok,
            SUM(CASE WHEN umidade <= 70 AND umidade >= 30 THEN 1 ELSE 0 END)         AS umidade_ok,
            SUM(CASE WHEN ruido <= 70   THEN 1 ELSE 0 END) AS ruido_ok,
            MAX(co2) AS max_co2, MAX(voc) AS max_voc, MAX(temperatura) AS max_temp,
            MAX(umidade) AS max_umidade, MAX(ruido) AS max_ruido
        FROM creative
        WHERE data >= DATE_SUB(NOW(), INTERVAL ${interval})
    `);

    const r = rows[0];
    const total = r.total || 1;
    function pct(ok) { return parseFloat(((ok / total) * 100).toFixed(1)); }

    const result = [
        { parametro: "CO2",        padrao_max: 1000, unidade: "ppm", pct_conformidade: pct(r.co2_ok),     desvio_max: parseFloat((r.max_co2     || 0).toFixed(0)) },
        { parametro: "VOC",        padrao_max: 400,  unidade: "ppb", pct_conformidade: pct(r.voc_ok),     desvio_max: parseFloat((r.max_voc     || 0).toFixed(0)) },
        { parametro: "Temperatura",padrao_max: 26,   unidade: "°C",  pct_conformidade: pct(r.temp_ok),    desvio_max: parseFloat((r.max_temp    || 0).toFixed(1)) },
        { parametro: "Umidade",    padrao_max: 70,   unidade: "%",   pct_conformidade: pct(r.umidade_ok), desvio_max: parseFloat((r.max_umidade || 0).toFixed(1)) },
        { parametro: "Ruído",      padrao_max: 70,   unidade: "dB",  pct_conformidade: pct(r.ruido_ok),   desvio_max: parseFloat((r.max_ruido   || 0).toFixed(0)) },
    ];

    const global = parseFloat((result.reduce((s, x) => s + x.pct_conformidade, 0) / result.length).toFixed(1));
    res.json({ global, parametros: result });
}));

module.exports = router;
