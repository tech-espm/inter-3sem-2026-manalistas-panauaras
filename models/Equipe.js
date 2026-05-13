const db = require("../data/db");

class Equipe {
    static async listar() {
        const [rows] = await db.query("SELECT * FROM equipe ORDER BY nome ASC");
        return rows;
    }
}

module.exports = Equipe;
