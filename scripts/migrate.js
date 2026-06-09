const { execSync } = require('child_process');
const path = require('path');

// Lista de scripts de migração na ordem correta de execução
const migrations = [
  'create_user_table.js',
  'update_user_table.js',
  'db_v2_equipe.js',
  'db_v3_alertas_ticket.js'
];

console.log("=== Iniciando Sincronização do Banco de Dados ===");

migrations.forEach(file => {
  const filePath = path.join(__dirname, file);
  console.log(`\n> Rodando: ${file}...`);
  try {
    // Executa o script de forma síncrona
    const output = execSync(`node "${filePath}"`, { stdio: 'inherit' });
  } catch (error) {
    console.error(`Erro ao executar ${file}. Verifique se o banco está ligado.`);
    // Não paramos o processo aqui para permitir que outras migrações tentem rodar
    // (Útil se uma tabela já existir, por exemplo)
  }
});

console.log("\n=== Banco de Dados Sincronizado com Sucesso ===\n");
