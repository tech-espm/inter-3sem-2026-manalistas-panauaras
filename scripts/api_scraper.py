# -*- coding: utf-8 -*-
from __future__ import print_function
import requests
import mysql.connector
from datetime import datetime, timedelta
import urllib3
import time

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# CONFIG BANCO
conn = mysql.connector.connect(
    host="localhost",
    user="root",
    password="root",
    database="sensores_db"
)
cursor = conn.cursor(buffered=True)

BASE_URL = "http://iagen.espm.br/sensores/dados"

# ============================================================
# MAPEAMENTO: id_sensor real → id_setor hospitalar simulado
# (deve ser consistente com o INSERT do script_inicial.sql)
# ============================================================

SENSOR_SETOR_MAP = {
    1: (1, "MULTISENSOR"),  # Creative → UTI (referência ambiental)
    2: (3, "HPD2"),         # PCA → Enfermaria Ala B
    3: (1, "HPD2"),         # PCA → UTI Adulto Ala A (maior volume)
    6: (2, "HPD2"),         # PCA → Sala de Espera Triagem
    7: (5, "HPD2"),         # PCA → Farmácia Central
    8: (4, "HPD2"),         # PCA → Centro Cirúrgico 02
}

def garantir_sensor_existe(id_sensor):
    """Garante que setor e sensor estejam cadastrados antes de inserir telemetria."""
    id_setor, tipo = SENSOR_SETOR_MAP.get(id_sensor, (1, "DESCONHECIDO"))

    cursor.execute("SELECT id_setor FROM setores WHERE id_setor = %s", (id_setor,))
    if not cursor.fetchone():
        # Setores devem vir do script SQL; como fallback cria um mínimo
        cursor.execute(
            "INSERT INTO setores (id_setor, nome_setor, tipo_setor) VALUES (%s, %s, 'Geral')",
            (id_setor, "Setor %s" % id_setor)
        )
        conn.commit()

    cursor.execute("SELECT id_sensor FROM sensores WHERE id_sensor = %s", (id_sensor,))
    if not cursor.fetchone():
        print("  [!] Cadastrando sensor %s (%s) no setor %s..." % (id_sensor, tipo, id_setor))
        cursor.execute(
            "INSERT INTO sensores (id_sensor, codigo_sensor, tipo_sensor, id_setor) VALUES (%s, %s, %s, %s)",
            (id_sensor, "SENSOR_%s" % id_sensor, tipo, id_setor)
        )
        conn.commit()

def buscar_dados_inicial(tipo_sensor, dias=2):
    """Carga inicial: busca por janela de datas (comportamento original).

    QUERY_OFFSET_DAYS: deslocamento fixo para trás para garantir que
    sempre haja dados na janela buscada, independentemente do horário atual.
    """
    QUERY_OFFSET_DAYS = 0  # dias de delay garantido
    hoje = datetime.now() +timedelta(days=QUERY_OFFSET_DAYS+1)
    inicio = hoje - timedelta(days=dias)
    url = "%s?sensor=%s&data_inicial=%s&data_final=%s" % (BASE_URL, tipo_sensor, inicio.date(), hoje.date())

    try:
        resposta = requests.get(url, verify=False, timeout=15)
        if resposta.status_code == 200:
            dados = resposta.json()
            print("  [API] %s: %s registros recebidos da API" % (tipo_sensor, len(dados)))
            print("  [URL] %s" % url)
            return dados
        print("  [ERR] Erro API %s: Status %s" % (tipo_sensor, resposta.status_code))
    except Exception as e:
        print("  [ERR] Erro conexao %s: %s" % (tipo_sensor, e))
    return []

def buscar_dados_novos(tipo_sensor, id_inferior):
    """Refresh incremental: busca apenas registros com id > id_inferior."""
    url = "%s?sensor=%s&id_inferior=%s" % (BASE_URL, tipo_sensor, id_inferior)
    try:
        resposta = requests.get(url, verify=False, timeout=15)
        if resposta.status_code == 200:
            dados = resposta.json()
            print("  [API] %s (refresh id>%s): %s novos registros" % (tipo_sensor, id_inferior, len(dados)))
            print("  [URL] %s" % url)
            return dados
        print("  [ERR] Erro API %s: Status %s" % (tipo_sensor, resposta.status_code))
    except Exception as e:
        print("  [ERR] Erro conexao %s: %s" % (tipo_sensor, e))
    return []

def get_ultimo_id_creative():
    """Retorna o maior id já armazenado na tabela creative, ou None."""
    cursor.execute("SELECT MAX(id) FROM creative")
    row = cursor.fetchone()
    return row[0] if row and row[0] is not None else None

def get_ultimo_id_pca():
    """Retorna o maior id já armazenado na tabela pca, ou None."""
    cursor.execute("SELECT MAX(id) FROM pca")
    row = cursor.fetchone()
    return row[0] if row and row[0] is not None else None

def inserir_creative(dados):
    if not dados:
        print("  [!] Creative: nenhum dado recebido.")
        return
    sql = """
    INSERT INTO creative (id, data, id_sensor, delta, luminosidade, umidade, temperatura,
    voc, co2, pressao_ar, ruido, aerosol_parado, aerosol_risco, ponto_orvalho)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    cont = 0
    for d in dados:
        garantir_sensor_existe(d["id_sensor"])
        valores = (d["id"], d["data"], d["id_sensor"], d["delta"], d["luminosidade"], d["umidade"],
                   d["temperatura"], d["voc"], d["co2"], d["pressao_ar"], d["ruido"],
                   d["aerosol_parado"], d["aerosol_risco"], d["ponto_orvalho"])
        try:
            cursor.execute(sql, valores)
            cont += 1
        except mysql.connector.Error as err:
            if err.errno != 1062:  # ignora duplicados (UNIQUE KEY)
                print("  Erro Creative: %s" % err)
    conn.commit()
    print("  [OK] Creative: %s novos registros inseridos." % cont)

def inserir_pca(dados):
    if not dados:
        print("  [!] PCA: nenhum dado recebido.")
        return
    sql = """
    INSERT INTO pca (id, data, id_sensor, delta, pessoas, luminosidade, umidade, temperatura)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
    """
    cont = 0
    for d in dados:
        garantir_sensor_existe(d["id_sensor"])
        valores = (d["id"], d["data"], d["id_sensor"], d["delta"], d["pessoas"],
                   d["luminosidade"], d["umidade"], d["temperatura"])
        try:
            cursor.execute(sql, valores)
            cont += 1
        except mysql.connector.Error as err:
            if err.errno != 1062:  # ignora duplicados
                print("  Erro PCA: %s" % err)
    conn.commit()
    print("  [OK] PCA: %s novos registros inseridos." % cont)

def processar_alertas():
    """
    Verifica os dados mais recentes de todos os sensores e gera/resolve alertas
    com base nos limiares definidos na tabela limiares_ambiente.
    """
    print("  [!] Verificando condicoes para novos alertas...")
    
    try:
        # 1. Buscar todos os limiares ambientais
        cursor.execute("SELECT tipo_setor, parametro, limite_critico, limite_atencao, unidade FROM limiares_ambiente")
        limiares = cursor.fetchall()
        
        # Organizar limiares por tipo_setor e parametro
        thresh = {}
        for t_setor, param, crit, aten, unit in limiares:
            if t_setor not in thresh: thresh[t_setor] = {}
            thresh[t_setor][param] = {"crit": crit, "aten": aten, "unit": unit}

        # 2. Buscar todos os sensores ativos e seus setores
        cursor.execute("""
            SELECT s.id_sensor, s.id_setor, s.tipo_sensor, st.tipo_setor, st.capacidade_maxima 
            FROM sensores s 
            JOIN setores st ON s.id_setor = st.id_setor 
            WHERE s.ativo = 1
        """)
        sensores = cursor.fetchall()
        
        for id_sensor, id_setor, tipo_sensor, tipo_setor_nome, cap_max in sensores:
            # Pegar a leitura mais recente deste sensor
            if tipo_sensor == 'MULTISENSOR':
                cursor.execute("SELECT co2, voc, temperatura, umidade, ruido, data FROM creative WHERE id_sensor = %s ORDER BY data DESC LIMIT 1", (id_sensor,))
                readings = cursor.fetchone()
                if not readings: continue
                
                vals = {
                    'CO2': (readings[0], 'ppm'),
                    'VOC': (readings[1], 'ppb'),
                    'TEMPERATURA': (readings[2], '°C'),
                    'UMIDADE': (readings[3], '%'),
                    'RUIDO': (readings[4], 'dB')
                }
                data_leitura = readings[5]
            else: # HPD2
                cursor.execute("SELECT pessoas, temperatura, umidade, data FROM pca WHERE id_sensor = %s ORDER BY data DESC LIMIT 1", (id_sensor,))
                readings = cursor.fetchone()
                if not readings: continue
                
                vals = {
                    'PESSOAS': (readings[0], 'pessoas'),
                    'TEMPERATURA': (readings[1], '°C'),
                    'UMIDADE': (readings[2], '%')
                }
                data_leitura = readings[3]

            # Verificar cada parâmetro
            for param, (val, unit) in vals.items():
                l = thresh.get(tipo_setor_nome, {}).get(param) or thresh.get('Geral', {}).get(param)
                
                if param == 'PESSOAS':
                    l = {"crit": cap_max, "aten": cap_max * 0.8, "unit": "pessoas"}
                
                if not l: continue

                severidade = None
                if val > l['crit']:
                    severidade = 'CRITICO'
                elif l['aten'] and val > l['aten']:
                    severidade = 'ATENCAO'

                cursor.execute("""
                    SELECT id_alerta, status, severidade 
                    FROM alertas 
                    WHERE id_sensor = %s AND parametro = %s AND status != 'RESOLVIDO'
                """, (id_sensor, param))
                alerta_existente = cursor.fetchone()

                if severidade:
                    if not alerta_existente:
                        sql = """
                            INSERT INTO alertas (id_sensor, id_setor, parametro, valor_medido, limite_referencia, unidade, severidade, status, disparado_em, descricao)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, 'ABERTO', %s, %s)
                        """
                        desc = "%s fora dos limites no setor %s. Valor: %s%s (Limite: %s%s)" % (param, tipo_setor_nome, val, unit, l['crit'], unit)
                        cursor.execute(sql, (id_sensor, id_setor, param, val, l['crit'], unit, severidade, data_leitura, desc))
                        print("  [!] NOVO ALERTA: Sensor %s | %s: %s%s" % (id_sensor, param, val, unit))
                else:
                    if alerta_existente:
                        cursor.execute("""
                            UPDATE alertas 
                            SET status = 'RESOLVIDO', normalizado_em = %s 
                            WHERE id_alerta = %s
                        """, (data_leitura, alerta_existente[0]))
                        print("  [OK] ALERTA RESOLVIDO: Sensor %s | %s voltou ao normal (%s%s)" % (id_sensor, param, val, unit))
        
        conn.commit()
    except Exception as e:
        print("  [ERR] Erro ao processar alertas: %s" % e)
        conn.rollback()

if __name__ == "__main__":
    print("=" * 55)
    print("  Sistema de Sincronizacao - Sensores ESPM -> MySQL")
    print("=" * 55)

    timeInterval = 60  # EM SEGUNDOS
    primeira_execucao = True

    while True:
        try:
            print("\n[INIT] [%s] Iniciando sincronizacao..." % datetime.now().strftime('%H:%M:%S'))

            if primeira_execucao:
                # -- Carga inicial por janela de datas ------------------
                print("  [MODO] carga inicial (janela de datas)")
                dados_creative = buscar_dados_inicial("creative", dias=1)
                inserir_creative(dados_creative)

                dados_pca = buscar_dados_inicial("pca", dias=1)
                inserir_pca(dados_pca)

                primeira_execucao = False
            else:
                # -- Refresh incremental via id_inferior ----------------
                print("  [MODO] refresh incremental (id_inferior)")

                ultimo_id_creative = get_ultimo_id_creative()
                if ultimo_id_creative is not None:
                    dados_creative = buscar_dados_novos("creative", ultimo_id_creative)
                    inserir_creative(dados_creative)
                else:
                    print("  [!] Creative: sem registros base, pulando refresh.")

                ultimo_id_pca = get_ultimo_id_pca()
                if ultimo_id_pca is not None:
                    dados_pca = buscar_dados_novos("pca", ultimo_id_pca)
                    inserir_pca(dados_pca)
                else:
                    print("  [!] PCA: sem registros base, pulando refresh.")

            print("--- Concluido. Proxima sincronizacao em %s segundos ---" % timeInterval)
            
            # -- Processamento de Alertas -------------------------------
            processar_alertas()
        except Exception as e:
            print("[ERR] Erro no loop principal: %s" % e)

        time.sleep(timeInterval)