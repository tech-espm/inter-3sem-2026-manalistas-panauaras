# Projeto Interdisciplinar III - Sistemas de Informação ESPM

<p align="center">
    <a href="https://www.espm.br/cursos-de-graduacao/sistemas-de-informacao/"><img src="https://raw.githubusercontent.com/tech-espm/misc-template/main/logo.png" alt="Sistemas de Informação ESPM" style="width: 375px;"/></a>
</p>

# Nome do Grupo

### 2026-01

## Visão Geral

## Participantes

- [Evelyn Chiaperini](https://github.com/kiapelyn)
- [Ihago Nunes](https://github.com/ihagonunes)
- [Ihan Nunes](https://github.com/Noxzxz)
- [Maria Eduarda Ortega](https://github.com/maduortega)

## Objetivos do Projeto

## Configuração e Execução do Projeto

Siga os passos abaixo para preparar e executar todos os componentes da aplicação (Front-end, Back-end, Banco de Dados e API Scraper).

### 1. Pré-requisitos
Certifique-se de ter instalado em sua máquina:
- **Node.js**
- **Python** (e `pip`)
- **MySQL** (Servidor rodando localmente)

### 2. Configuração do Banco de Dados
1. Inicie o serviço do **MySQL**.
2. Crie um banco de dados vazio chamado `sensores_db` (ou o nome que preferir).
3. Importe a estrutura base e os dados iniciais executando o script SQL disponível em `sql/script_inicial.sql` no seu banco de dados.

### 3. Variáveis de Ambiente
Crie um arquivo chamado `.env` na raiz do projeto. Utilize o conteúdo abaixo como base e ajuste as credenciais (`DB_USER` e `DB_PASSWORD`) de acordo com a sua instalação local do MySQL:

```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=root
DB_DATABASE=sensores_db
```

### 4. Instalação de Dependências

**Dependências do Node.js (Servidor Web e Front-end):**
No terminal, na raiz do projeto, rode o comando:
```bash
npm install
```

**Dependências do Python (Geração de Relatórios e API Scraper):**
Em seguida, instale as bibliotecas Python necessárias:
```bash
pip install -r requirements.txt
```

### 5. Executando a Aplicação

Para o funcionamento completo do sistema, você precisará de **dois terminais** abertos.

**Terminal 1: Servidor Web (Front-end e API Node.js)**
Inicie a aplicação Node. Isso também rodará automaticamente os scripts de migração complementares.
```bash
npm start
```
Após iniciado, o sistema estará disponível no seu navegador (geralmente em `http://localhost:3000` ou a porta configurada). Os relatórios em Python serão chamados automaticamente pelo back-end conforme a necessidade.

**Terminal 2: Coletor de Dados (API Scraper)**
Para manter os dados dos sensores atualizados continuamente no banco de dados, rode o serviço em background em outro terminal:
```bash
python scripts/api_scraper.py
```

# Licença

Este projeto é licenciado sob a [MIT License](https://github.com/tech-espm/inter-3sem-2026-manalistas-panauaras/blob/main/LICENSE).

<p align="right">
    <a href="https://www.espm.br/cursos-de-graduacao/sistemas-de-informacao/"><img src="https://raw.githubusercontent.com/tech-espm/misc-template/main/logo-si-512.png" alt="Sistemas de Informação ESPM" style="width: 375px;"/></a>
</p>
