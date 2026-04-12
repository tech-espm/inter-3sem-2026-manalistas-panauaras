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

BASE_URL = "https://iagen.espm.br/sensores/dados"

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

def buscar_dados(tipo_sensor, dias=2):
    """Busca dados na API baseada no tipo (creative ou pca)."""
    hoje = datetime.now()
    inicio = hoje - timedelta(days=dias)
    url = f"{BASE_URL}?sensor={tipo_sensor}&data_inicial={inicio.date()}&data_final={hoje.date()}"

    try:
        resposta = requests.get(url, verify=False, timeout=15)
        if resposta.status_code == 200:
            dados = resposta.json()
            print(f"  📡 {tipo_sensor}: {len(dados)} registros recebidos da API")
            return dados
        print(f"  ❌ Erro API {tipo_sensor}: Status {resposta.status_code}")
    except Exception as e:
        print(f"  ❌ Erro conexão {tipo_sensor}: {e}")
    return []

def inserir_creative(dados):
    if not dados:
        print("  ⚠️  Creative: nenhum dado recebido.")
        return
    sql = """
    INSERT INTO creative (data, id_sensor, delta, luminosidade, umidade, temperatura,
    voc, co2, pressao_ar, ruido, aerosol_parado, aerosol_risco, ponto_orvalho)
    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    cont = 0
    for d in dados:
        garantir_sensor_existe(d["id_sensor"])
        valores = (d["data"], d["id_sensor"], d["delta"], d["luminosidade"], d["umidade"],
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
    INSERT INTO pca (data, id_sensor, delta, pessoas, luminosidade, umidade, temperatura)
    VALUES (%s, %s, %s, %s, %s, %s, %s)
    """
    cont = 0
    for d in dados:
        garantir_sensor_existe(d["id_sensor"])
        valores = (d["data"], d["id_sensor"], d["delta"], d["pessoas"],
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

    while True:
        try:
            print(f"\n🚀 [{datetime.now().strftime('%H:%M:%S')}] Iniciando sincronização...")

            dados_creative = buscar_dados("creative", dias=2)
            inserir_creative(dados_creative)

            dados_pca = buscar_dados("pca", dias=2)
            inserir_pca(dados_pca)

            print(f"🏁 Concluído. Próxima sincronização em 10 segundos...")
        except Exception as e:
            print(f"❌ Erro no loop principal: {e}")

        time.sleep(10)