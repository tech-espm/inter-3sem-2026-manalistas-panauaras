import requests
import mysql.connector
from datetime import datetime, timedelta
import urllib3
import time

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# 🔹 CONFIG BANCO
conn = mysql.connector.connect(
    host="localhost",
    user="root",
    password="root",
    database="sensores_db"
)
cursor = conn.cursor()

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
            (id_setor, f"Setor {id_setor}")
        )
        conn.commit()

    cursor.execute("SELECT id_sensor FROM sensores WHERE id_sensor = %s", (id_sensor,))
    if not cursor.fetchone():
        print(f"  ⚠️  Cadastrando sensor {id_sensor} ({tipo}) no setor {id_setor}...")
        cursor.execute(
            "INSERT INTO sensores (id_sensor, codigo_sensor, tipo_sensor, id_setor) VALUES (%s, %s, %s, %s)",
            (id_sensor, f"SENSOR_{id_sensor}", tipo, id_setor)
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
    url = f"{BASE_URL}?sensor={tipo_sensor}&data_inicial={inicio.date()}&data_final={hoje.date()}"

    try:
        resposta = requests.get(url, verify=False, timeout=15)
        if resposta.status_code == 200:
            dados = resposta.json()
            print(f"  📡 {tipo_sensor}: {len(dados)} registros recebidos da API")
            print(f"  📝 {url}")
            return dados
        print(f"  ❌ Erro API {tipo_sensor}: Status {resposta.status_code}")
    except Exception as e:
        print(f"  ❌ Erro conexão {tipo_sensor}: {e}")
    return []

def buscar_dados_novos(tipo_sensor, id_inferior):
    """Refresh incremental: busca apenas registros com id > id_inferior."""
    url = f"{BASE_URL}?sensor={tipo_sensor}&id_inferior={id_inferior}"
    try:
        resposta = requests.get(url, verify=False, timeout=15)
        if resposta.status_code == 200:
            dados = resposta.json()
            print(f"  📡 {tipo_sensor} (refresh id>{id_inferior}): {len(dados)} novos registros")
            print(f"  📝 {url}")
            return dados
        print(f"  ❌ Erro API {tipo_sensor}: Status {resposta.status_code}")
    except Exception as e:
        print(f"  ❌ Erro conexão {tipo_sensor}: {e}")
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
        print("  ⚠️  Creative: nenhum dado recebido.")
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
                print(f"  Erro Creative: {err}")
    conn.commit()
    print(f"  ✅ Creative: {cont} novos registros inseridos.")

def inserir_pca(dados):
    if not dados:
        print("  ⚠️  PCA: nenhum dado recebido.")
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
                print(f"  Erro PCA: {err}")
    conn.commit()
    print(f"  ✅ PCA: {cont} novos registros inseridos.")

if __name__ == "__main__":
    print("=" * 55)
    print("  Sistema de Sincronização — Sensores ESPM → MySQL")
    print("=" * 55)

    timeInterval = 60  # EM SEGUNDOS
    primeira_execucao = True

    while True:
        try:
            print(f"\n🚀 [{datetime.now().strftime('%H:%M:%S')}] Iniciando sincronização...")

            if primeira_execucao:
                # ── Carga inicial por janela de datas ──────────────────
                print("  🔄 Modo: carga inicial (janela de datas)")
                dados_creative = buscar_dados_inicial("creative", dias=1)
                inserir_creative(dados_creative)

                dados_pca = buscar_dados_inicial("pca", dias=1)
                inserir_pca(dados_pca)

                primeira_execucao = False
            else:
                # ── Refresh incremental via id_inferior ────────────────
                print("  🔄 Modo: refresh incremental (id_inferior)")

                ultimo_id_creative = get_ultimo_id_creative()
                if ultimo_id_creative is not None:
                    dados_creative = buscar_dados_novos("creative", ultimo_id_creative)
                    inserir_creative(dados_creative)
                else:
                    print("  ⚠️  Creative: sem registros base, pulando refresh.")

                ultimo_id_pca = get_ultimo_id_pca()
                if ultimo_id_pca is not None:
                    dados_pca = buscar_dados_novos("pca", ultimo_id_pca)
                    inserir_pca(dados_pca)
                else:
                    print("  ⚠️  PCA: sem registros base, pulando refresh.")

            print(f"🏁 Concluído. Próxima sincronização em {timeInterval} segundos...")
        except Exception as e:
            print(f"❌ Erro no loop principal: {e}")

        time.sleep(timeInterval)