/* ======================================================================
   ESQUEMA DO PROJETO – SISTEMA INTELIGENTE AMBIENTAL HOSPITALAR
   Versão: MySQL 5.7.15
   ====================================================================== */

drop database sensores_db;

CREATE DATABASE IF NOT EXISTS sensores_db;
USE sensores_db;

-- =========================
-- 1. CONTEXTO (SETOR / SENSOR)
-- =========================

CREATE TABLE setores (
    id_setor        BIGINT NOT NULL AUTO_INCREMENT,
    nome_setor      VARCHAR(100) NOT NULL,
    tipo_setor      VARCHAR(50)  NOT NULL,  -- UTI, Enfermaria, Banheiro, etc.
    andar           VARCHAR(20),
    capacidade_maxima INT DEFAULT 25,       -- necessária para calcular % de ocupacao
    ativo           TINYINT(1) DEFAULT 1,
    PRIMARY KEY (id_setor)
) ENGINE=InnoDB;

CREATE TABLE sensores (
    id_sensor       TINYINT NOT NULL,           -- mesmo id_sensor da telemetria
    codigo_sensor   VARCHAR(100) NOT NULL,
    tipo_sensor     VARCHAR(30)  NOT NULL,      -- 'MULTISENSOR' ou 'HPD2'
    id_setor        BIGINT NOT NULL,
    instalado_em    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ativo           TINYINT(1) DEFAULT 1,
    PRIMARY KEY (id_sensor),
    CONSTRAINT fk_sensores_setor
        FOREIGN KEY (id_setor) REFERENCES setores(id_setor)
) ENGINE=InnoDB;

-- =========================
-- 2. TELEMETRIA – MULTISENSOR (CREATIVE)
-- =========================

CREATE TABLE creative (
    id               BIGINT NOT NULL AUTO_INCREMENT,
    data             DATETIME NOT NULL,
    id_sensor        TINYINT NOT NULL,
    delta            INT NOT NULL,         -- segundos
    luminosidade     FLOAT NOT NULL,       -- lx
    umidade          FLOAT NOT NULL,       -- % RH
    temperatura      FLOAT NOT NULL,       -- °C
    voc              FLOAT NOT NULL,       -- ppb
    co2              FLOAT NOT NULL,       -- ppm
    pressao_ar       FLOAT NOT NULL,       -- mbar
    ruido            FLOAT NOT NULL,       -- dB
    aerosol_parado   TINYINT NOT NULL,     -- %
    aerosol_risco    TINYINT NOT NULL,     -- %
    ponto_orvalho    FLOAT NOT NULL,       -- °C
    PRIMARY KEY (id),
    CONSTRAINT fk_creative_sensor
        FOREIGN KEY (id_sensor) REFERENCES sensores(id_sensor)
) ENGINE=InnoDB;

CREATE UNIQUE INDEX idx_creative_sensor_data ON creative (id_sensor, data);

-- =========================
-- 3. TELEMETRIA – HPD2 / PCA (OCUPAÇÃO)
-- =========================

CREATE TABLE pca (
    id               BIGINT NOT NULL AUTO_INCREMENT,
    data             DATETIME NOT NULL,
    id_sensor        TINYINT NOT NULL,
    delta            INT NOT NULL,       -- segundos
    pessoas          TINYINT NOT NULL,   -- quantidade de pessoas detectadas
    luminosidade     FLOAT NOT NULL,     -- lx
    umidade          FLOAT NOT NULL,     -- % RH
    temperatura      FLOAT NOT NULL,     -- °C
    PRIMARY KEY (id),
    CONSTRAINT fk_pca_sensor
        FOREIGN KEY (id_sensor) REFERENCES sensores(id_sensor)
) ENGINE=InnoDB;

CREATE UNIQUE INDEX idx_pca_sensor_data ON pca (id_sensor, data);

-- =========================
-- 4. LIMIARES E ALERTAS
-- =========================

CREATE TABLE limiares_ambiente (
    id_limiar        BIGINT NOT NULL AUTO_INCREMENT,
    tipo_setor      VARCHAR(50) NOT NULL,   -- UTI, Enfermaria, Banheiro...
    parametro       VARCHAR(30) NOT NULL,   -- 'CO2', 'VOC', 'TEMPERATURA', 'UMIDADE', 'RUIDO', etc.
    limite_critico  FLOAT NOT NULL,
    limite_atencao  FLOAT,
    unidade         VARCHAR(10) NOT NULL,   -- 'ppm', 'ppb', '°C', '%', 'lx', 'dB'
    PRIMARY KEY (id_limiar)
) ENGINE=InnoDB;

CREATE TABLE alertas (
    id_alerta           BIGINT NOT NULL AUTO_INCREMENT,
    id_sensor           TINYINT NOT NULL,
    id_setor            BIGINT NOT NULL,
    parametro           VARCHAR(30) NOT NULL,  -- CO2, VOC, TEMPERATURA, etc.
    valor_medido        FLOAT NOT NULL,
    limite_referencia   FLOAT NOT NULL,
    unidade             VARCHAR(10) NOT NULL,
    severidade          VARCHAR(20) NOT NULL,  -- 'CRITICO', 'ATENCAO'
    status              VARCHAR(20) NOT NULL DEFAULT 'ABERTO', -- 'ABERTO', 'EM_ATENDIMENTO', 'RESOLVIDO'
    disparado_em        DATETIME NOT NULL,
    atendimento_iniciado_em DATETIME NULL,
    normalizado_em      DATETIME NULL,
    descricao           TEXT,
    PRIMARY KEY (id_alerta),
    CONSTRAINT fk_alertas_sensor
        FOREIGN KEY (id_sensor) REFERENCES sensores(id_sensor),
    CONSTRAINT fk_alertas_setor
        FOREIGN KEY (id_setor) REFERENCES setores(id_setor)
) ENGINE=InnoDB;

-- ======================================================================
-- 5. SEED DE DADOS — Executar após recriar o schema
-- ======================================================================
USE sensores_db;

-- 5.1 SETORES HOSPITALARES (mapeamento dos ambientes reais da ESPM)
-- O sensor PCA real é alocado em cada setor pelo campo id_sensor em sensores
INSERT INTO setores (id_setor, nome_setor, tipo_setor, andar, capacidade_maxima) VALUES
(1, 'UTI Adulto - Ala A',        'UTI',        '3',  10),
(2, 'Sala de Espera - Triagem',  'Recepção',   '1',  30),
(3, 'Enfermaria - Ala B',        'Enfermaria', '2',  20),
(4, 'Centro Cirúrgico 02',       'Cirurgia',   '2',   8),
(5, 'Farmácia Central',          'Farmácia',   '1',  15);

-- 5.2 SENSORES (mapeamento dos sensores reais da API ESPM para os setores hospitalares)
-- PCA id=3: setor 1 (UTI) — maior volume real de registros
-- PCA id=6: setor 2 (Triagem) — segundo maior volume
-- PCA id=2: setor 3 (Enfermaria)
-- PCA id=8: setor 4 (Centro Cirúrgico)
-- PCA id=7: setor 5 (Farmácia)
-- Creative id=1: setor 1 (referência ambiental para todos os setores)
INSERT INTO sensores (id_sensor, codigo_sensor, tipo_sensor, id_setor) VALUES
(1, 'CREATIVE-01',  'MULTISENSOR', 1),
(2, 'HPD2-ENFA-B',  'HPD2',        3),
(3, 'HPD2-UTI-A',   'HPD2',        1),
(6, 'HPD2-TRIAG',   'HPD2',        2),
(7, 'HPD2-FARM',    'HPD2',        5),
(8, 'HPD2-CC02',    'HPD2',        4);

-- 5.3 LIMIARES ANVISA / ABNT por tipo de setor e parâmetro
INSERT INTO limiares_ambiente (tipo_setor, parametro, limite_critico, limite_atencao, unidade) VALUES
-- Gerais (valem para todos os setores sem limiar específico)
('Geral',      'CO2',         1000,  800,  'ppm'),
('Geral',      'VOC',          400,  250,  'ppb'),
('Geral',      'TEMPERATURA',   26,   24,  '°C'),
('Geral',      'UMIDADE',       70,   60,  '%'),
('Geral',      'RUIDO',         70,   55,  'dB'),
-- UTI tem limiares mais rigorosos
('UTI',        'CO2',           800,  600,  'ppm'),
('UTI',        'TEMPERATURA',    24,   22,  '°C'),
('UTI',        'UMIDADE',        60,   50,  '%'),
('UTI',        'RUIDO',          55,   45,  'dB'),
-- Centro Cirúrgico
('Cirurgia',   'CO2',           700,  500,  'ppm'),
('Cirurgia',   'TEMPERATURA',    22,   20,  '°C'),
('Cirurgia',   'RUIDO',          50,   40,  'dB'),
-- Recepção / Triagem
('Recepção',   'CO2',           1200,  900,  'ppm'),
('Recepção',   'RUIDO',          75,   65,  'dB');

-- 5.4 ALERTAS SIMULADOS (para popular a Central de Alertas e KPIs de SLA)
-- Baseados nos sensores mapeados acima
INSERT INTO alertas
(id_sensor, id_setor, parametro, valor_medido, limite_referencia, unidade, severidade, status, disparado_em, atendimento_iniciado_em, normalizado_em, descricao)
VALUES
-- Alerta 1: CO2 crítico na UTI (já resolvido, respondido em 5 min — dentro do SLA)
(3, 1, 'CO2', 1150.5, 1000, 'ppm', 'CRITICO', 'RESOLVIDO',
 DATE_SUB(NOW(), INTERVAL 2 HOUR),
 DATE_SUB(NOW(), INTERVAL 115 MINUTE),
 DATE_SUB(NOW(), INTERVAL 90 MINUTE),
 'Nível crítico de CO2 detectado na UTI Adulto - Ala A. Ventilação acionada.'),

-- Alerta 2: Temperatura alta na UTI (em atendimento, respondido em 8 min — dentro do SLA)
(1, 1, 'TEMPERATURA', 26.8, 24, '°C', 'CRITICO', 'EM_ATENDIMENTO',
 DATE_SUB(NOW(), INTERVAL 45 MINUTE),
 DATE_SUB(NOW(), INTERVAL 37 MINUTE),
 NULL,
 'Temperatura acima do limite crítico da UTI. Verificação do ar-condicionado iniciada.'),

-- Alerta 3: Ruído alto na Triagem (aberto, sem atendimento — fora do SLA)
(6, 2, 'RUIDO', 82.0, 75, 'dB', 'CRITICO', 'ABERTO',
 DATE_SUB(NOW(), INTERVAL 25 MINUTE),
 NULL, NULL,
 'Pico de ruído acima do limite crítico na Sala de Espera - Triagem.'),

-- Alerta 4: VOC elevado (atenção, resolvido fora do SLA de 15 min)
(1, 3, 'VOC', 310.0, 250, 'ppb', 'ATENCAO', 'RESOLVIDO',
 DATE_SUB(NOW(), INTERVAL 3 HOUR),
 DATE_SUB(NOW(), INTERVAL 155 MINUTE),
 DATE_SUB(NOW(), INTERVAL 120 MINUTE),
 'VOC acima do nível de atenção na Enfermaria Ala B.'),

-- Alerta 5: CO2 de atenção na Farmácia (aberto, recente)
(7, 5, 'CO2', 870.0, 800, 'ppm', 'ATENCAO', 'ABERTO',
 DATE_SUB(NOW(), INTERVAL 8 MINUTE),
 NULL, NULL,
 'CO2 próximo ao limite crítico na Farmácia Central.'),

-- Alerta 6: Superlotação na Triagem (critico, em atendimento)
(6, 2, 'PESSOAS', 33.0, 30, 'pessoas', 'CRITICO', 'EM_ATENDIMENTO',
 DATE_SUB(NOW(), INTERVAL 15 MINUTE),
 DATE_SUB(NOW(), INTERVAL 10 MINUTE),
 NULL,
 'Capacidade máxima excedida na Sala de Espera - Triagem. Fluxo monitorado.');

-- ======================================================================
-- 6. QUERIES DE APOIO (Referência para o Backend Node.js)
-- ======================================================================

-- 6.1 STATUS ATUAL por setor (base para /api/dashboard/heatmap)
-- SELECT
--     st.id_setor, st.nome_setor, st.tipo_setor,
--     u.data AS ultima_leitura, u.co2, u.voc, u.temperatura, u.umidade, u.ruido,
--     CASE
--         WHEN u.co2 > 1000 OR u.voc > 400 THEN 'CRITICO'
--         WHEN u.co2 > 800  OR u.voc > 250 THEN 'ATENCAO'
--         ELSE 'NORMAL'
--     END AS status_setor
-- FROM (
--     SELECT c.* FROM creative c
--     JOIN (SELECT id_sensor, MAX(data) AS data_max FROM creative GROUP BY id_sensor) ult
--     ON ult.id_sensor = c.id_sensor AND ult.data_max = c.data
-- ) u
-- JOIN sensores s ON s.id_sensor = u.id_sensor
-- JOIN setores st ON st.id_setor = s.id_setor;

-- 6.2 KPIs DE ALERTAS (base para /api/alertas/kpis)
-- SELECT
--     COUNT(*) AS total_alertas,
--     AVG(TIMESTAMPDIFF(MINUTE, disparado_em, atendimento_iniciado_em)) AS tempo_medio_resposta_min,
--     AVG(TIMESTAMPDIFF(MINUTE, disparado_em, normalizado_em))          AS tempo_medio_resolucao_min,
--     SUM(CASE WHEN atendimento_iniciado_em IS NOT NULL
--              AND TIMESTAMPDIFF(MINUTE, disparado_em, atendimento_iniciado_em) <= 15
--         THEN 1 ELSE 0 END) / COUNT(*) * 100 AS pct_resposta_no_sla
-- FROM alertas
-- WHERE disparado_em >= DATE_SUB(NOW(), INTERVAL 7 DAY);

-- 6.3 CORRELAÇÃO CO2 x PESSOAS por minuto (base para /api/graficos/correlacao)
-- SELECT a.minuto, a.co2_medio, o.pessoas_medias
-- FROM (
--     SELECT s.id_setor, DATE_FORMAT(c.data,'%Y-%m-%d %H:%i:00') AS minuto, AVG(c.co2) AS co2_medio
--     FROM creative c JOIN sensores s ON s.id_sensor = c.id_sensor
--     GROUP BY s.id_setor, minuto
-- ) a
-- JOIN (
--     SELECT s.id_setor, DATE_FORMAT(p.data,'%Y-%m-%d %H:%i:00') AS minuto, AVG(p.pessoas) AS pessoas_medias
--     FROM pca p JOIN sensores s ON s.id_sensor = p.id_sensor
--     GROUP BY s.id_setor, minuto
-- ) o ON o.id_setor = a.id_setor AND o.minuto = a.minuto
-- WHERE a.id_setor = 1;


-- 5.1 DASHBOARD – STATUS ATUAL (USANDO SUBQUERY EM VEZ DE CTE)
SELECT
    st.id_setor,
    st.nome_setor,
    st.tipo_setor,
    u.data AS ts_ultima,
    u.co2,
    u.voc,
    u.temperatura,
    u.umidade,
    u.ruido,
    CASE
        WHEN u.co2 > 1000 OR u.voc > 400 THEN 'CRITICO'
        WHEN u.co2 > 800  OR u.voc > 250 THEN 'ATENCAO'
        ELSE 'NORMAL'
    END AS status_setor
FROM (
    SELECT c.*
    FROM creative c
    JOIN (
        SELECT id_sensor, MAX(data) AS data_max
        FROM creative
        GROUP BY id_sensor
    ) ult ON ult.id_sensor = c.id_sensor AND ult.data_max = c.data
) u
JOIN sensores s ON s.id_sensor = u.id_sensor
JOIN setores st ON st.id_setor = s.id_setor;

-- 5.5 CORRELAÇÃO – CO2 x PESSOAS 
SELECT
    a.minuto,
    a.co2_medio,
    o.pessoas_medias
FROM (
    -- Subquery Ambiental
    SELECT
        s.id_setor,
        DATE_FORMAT(c.data, '%Y-%m-%d %H:%i:00') AS minuto,
        AVG(c.co2) AS co2_medio
    FROM creative c
    JOIN sensores s ON s.id_sensor = c.id_sensor
    -- WHERE c.data BETWEEN '2023-01-01' AND '2023-01-02' -- Exemplo de filtro
    GROUP BY s.id_setor, minuto
) a
JOIN (
    -- Subquery Ocupação
    SELECT
        s.id_setor,
        DATE_FORMAT(p.data, '%Y-%m-%d %H:%i:00') AS minuto,
        AVG(p.pessoas) AS pessoas_medias
    FROM pca p
    JOIN sensores s ON s.id_sensor = p.id_sensor
    -- WHERE p.data BETWEEN '2023-01-01' AND '2023-01-02' -- Exemplo de filtro
    GROUP BY s.id_setor, minuto
) o ON o.id_setor = a.id_setor AND o.minuto = a.minuto
WHERE a.id_setor = 1; -- Exemplo de id_setor

-- 5.7 KPIs DE ALERTAS (ADAPTADO)
-- Nota: Substituí :sla_resposta_min por um valor fixo (ex: 15) para teste
SELECT
    COUNT(*) AS total_alertas,
    AVG(TIMESTAMPDIFF(MINUTE, disparado_em, atendimento_iniciado_em)) AS tempo_medio_resposta_min,
    AVG(TIMESTAMPDIFF(MINUTE, disparado_em, normalizado_em))          AS tempo_medio_resolucao_min,
    (SUM(
        CASE 
            WHEN atendimento_iniciado_em IS NOT NULL
             AND TIMESTAMPDIFF(MINUTE, disparado_em, atendimento_iniciado_em) <= 15 -- SLA exemplo
            THEN 1 ELSE 0
        END
    ) / COUNT(*)) * 100 AS pct_resposta_no_sla
FROM alertas;


SELECT * FROM pca;

SELECT * FROM creative;

select * from sensores;

select * from setores;

select count(*) from pca where id_sensor = 3;
select count(*) from pca where id_sensor = 7;
select count(*) from pca where id_sensor = 6;
select count(*) from creative;
select id_sensor, count(*) from pca group by id_sensor;

select * from pca;

USE sensores_db;

-- ==========================================================
-- 1. POPULAR DADOS BASE (Setores e Sensores)
-- ==========================================================
-- Precisamos inserir o setor e os sensores antes para não dar
-- erro de Foreign Key (Chave Estrangeira) na hora de inserir os alertas!

INSERT INTO setores (id_setor, nome_setor, tipo_setor, andar, capacidade_maxima) VALUES 
(1, 'Setor Automático', 'Geral', '1', 25)
ON DUPLICATE KEY UPDATE nome_setor=nome_setor;

INSERT INTO sensores (id_sensor, codigo_sensor, tipo_sensor, id_setor) VALUES
(1, 'SENSOR_1', 'MULTISENSOR', 1),
(3, 'SENSOR_3', 'HPD2', 1)
ON DUPLICATE KEY UPDATE codigo_sensor=codigo_sensor;

-- ==========================================================
-- 2. POPULAR LIMIARES (A inteligência do sistema)
-- ==========================================================
-- Definimos o que é aceitável para cada tipo de setor.
-- Isso permitirá que o sistema identifique o que é um alerta.

INSERT INTO limiares_ambiente (tipo_setor, parametro, limite_critico, limite_atencao, unidade) VALUES
('Geral', 'CO2', 1000, 800, 'ppm'),
('Geral', 'VOC', 400, 250, 'ppb'),
('Geral', 'TEMPERATURA', 26, 24, '°C'),
('Geral', 'RUIDO', 70, 55, 'dB'),
('UTI', 'CO2', 800, 600, 'ppm'),
('Enfermaria', 'UMIDADE', 70, 60, '%');

-- ==========================================================
-- 2. SIMULAR ALERTAS (Baseado nos dados que o scraper traz)
-- ==========================================================
-- Como a tabela 'alertas' geralmente é populada por um gatilho (trigger) 
-- ou backend, vamos inserir dados manuais para testar os KPIs de SLA.

INSERT INTO alertas 
(id_sensor, id_setor, parametro, valor_medido, limite_referencia, unidade, severidade, status, disparado_em, atendimento_iniciado_em, normalizado_em, descricao) 
VALUES
(1, 1, 'CO2', 1150.5, 1000, 'ppm', 'CRITICO', 'RESOLVIDO', 
 DATE_SUB(NOW(), INTERVAL 2 HOUR), DATE_SUB(NOW(), INTERVAL 115 MINUTE), DATE_SUB(NOW(), INTERVAL 30 MINUTE), 
 'Nível de CO2 crítico detectado no Setor Automático.'),

(1, 1, 'TEMPERATURA', 28.2, 26, '°C', 'CRITICO', 'EM_ATENDIMENTO', 
 DATE_SUB(NOW(), INTERVAL 45 MINUTE), DATE_SUB(NOW(), INTERVAL 40 MINUTE), NULL, 
 'Ar condicionado parece estar com falha.'),

(3, 1, 'RUIDO', 62.0, 55, 'dB', 'ATENCAO', 'ABERTO', 
 DATE_SUB(NOW(), INTERVAL 10 MINUTE), NULL, NULL, 
 'Pico de ruído acima do limite de atenção.');

-- ==========================================================
-- 3. BATERIA DE TESTES (QUERIES DE VALIDAÇÃO)
-- ==========================================================

-- A. Teste de Consistência: Existem sensores sem setor?
SELECT s.id_sensor, s.tipo_sensor, st.nome_setor 
FROM sensores s 
LEFT JOIN setores st ON s.id_setor = st.id_setor
WHERE st.id_setor IS NULL;

-- B. Teste de Cruzamento: Qual a média de CO2 por tipo de setor?
SELECT st.tipo_setor, AVG(c.co2) as media_co2
FROM creative c
JOIN sensores s ON c.id_sensor = s.id_sensor
JOIN setores st ON s.id_setor = st.id_setor
GROUP BY st.tipo_setor;

-- C. Teste de Ocupação: Setores que excederam a capacidade_maxima (25)
SELECT st.nome_setor, p.data, p.pessoas 
FROM pca p
JOIN sensores s ON p.id_sensor = s.id_sensor
JOIN setores st ON s.id_setor = st.id_setor
WHERE p.pessoas > st.capacidade_maxima; -- O padrão é 25 no seu script

-- D. Teste de KPI: Qual a porcentagem de alertas atendidos em menos de 15 min?
-- (Roda a query 5.7 do seu script original aqui)
SELECT 
    COUNT(*) AS total_alertas,
    AVG(TIMESTAMPDIFF(MINUTE, disparado_em, atendimento_iniciado_em)) AS tempo_medio_resposta_min,
    (SUM(CASE WHEN TIMESTAMPDIFF(MINUTE, disparado_em, atendimento_iniciado_em) <= 15 THEN 1 ELSE 0 END) / COUNT(*)) * 100 AS pct_resposta_no_sla
FROM alertas;