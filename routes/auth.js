const express = require("express");
const router = express.Router();
const pool = require("../data/db");
const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, "public/uploads/profile");
    },
    filename: (req, file, cb) => {
        cb(null, req.session.usuario.id + "-" + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

router.get("/login", (req, res) => {
    res.render("index/login", { layout: false });
});

router.get("/completar-perfil", (req, res) => {
    res.render("index/completar_perfil", { layout: false, usuario: req.session.usuario || {} });
});

router.post("/api/auth/login", async (req, res) => {
    const { email, senha } = req.body;

    try {
        const [rows] = await pool.query("SELECT * FROM usuario WHERE email = ?", [email]);

        if (rows.length === 0) {
            return res.status(401).json({ mensagem: "Usuário não encontrado!" });
        }

        const usuario = rows[0];

        if (senha !== usuario.senha) {
            return res.status(401).json({ mensagem: "Senha incorreta!" });
        }

        req.session.usuario = {
            id: usuario.id_usuario,
            nome: usuario.nome,
            email: usuario.email,
            cargo: usuario.cargo,
            foto: usuario.foto,
            perfilCompleto: !!(usuario.cargo && usuario.telefone)
        };

        res.json({ mensagem: "Sucesso!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensagem: "Erro interno no servidor." });
    }
});


router.post("/api/auth/signup", async (req, res) => {
    const { nome, email, senha } = req.body;

    try {
        const [existing] = await pool.query("SELECT id_usuario FROM usuario WHERE email = ?", [email]);
        if (existing.length > 0) {
            return res.status(400).json({ mensagem: "Este email já está cadastrado!" });
        }

        const [result] = await pool.query("INSERT INTO usuario (nome, email, senha) VALUES (?, ?, ?)", [nome, email, senha]);

        req.session.usuario = {
            id: result.insertId,
            nome: nome,
            email: email,
            perfilCompleto: false
        };

        res.json({ mensagem: "Usuário criado!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensagem: "Erro ao criar usuário." });
    }
});

router.post("/api/auth/completar-perfil", upload.single("foto"), async (req, res) => {
    if (!req.session.usuario) {
        return res.status(401).json({ mensagem: "Não autorizado." });
    }

    const { nome, email, senha, cargo, telefone } = req.body;
    const fotoPath = req.file ? `/public/uploads/profile/${req.file.filename}` : null;

    try {
        const updates = [];
        const values = [];

        if (nome) { updates.push("nome = ?"); values.push(nome); }
        if (email) { updates.push("email = ?"); values.push(email); }
        if (senha) { updates.push("senha = ?"); values.push(senha); }
        if (cargo) { updates.push("cargo = ?"); values.push(cargo); }
        if (telefone) { updates.push("telefone = ?"); values.push(telefone); }
        if (fotoPath) { updates.push("foto = ?"); values.push(fotoPath); }

        if (updates.length > 0) {
            values.push(req.session.usuario.id);
            await pool.query(
                `UPDATE usuario SET ${updates.join(", ")} WHERE id_usuario = ?`,
                values
            );
        }

        req.session.usuario.perfilCompleto = true;
        if (nome) req.session.usuario.nome = nome;
        if (email) req.session.usuario.email = email;
        if (cargo) req.session.usuario.cargo = cargo;
        if (fotoPath) req.session.usuario.foto = fotoPath;

        res.json({ mensagem: "Perfil atualizado!" });
    } catch (error) {
        console.error(error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ mensagem: "Este email já está em uso." });
        }
        res.status(500).json({ mensagem: "Erro ao atualizar perfil." });
    }
});


router.delete("/api/auth/usuario", async (req, res) => {
    if (!req.session.usuario) {
        return res.status(401).json({ mensagem: "Não autorizado." });
    }
    try {
        await pool.query("DELETE FROM usuario WHERE id_usuario = ?", [req.session.usuario.id]);
        req.session.destroy();
        res.json({ mensagem: "Conta excluída com sucesso." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensagem: "Erro ao excluir conta." });
    }
});

router.get("/api/auth/usuario", async (req, res) => {
    if (!req.session.usuario) {
        return res.status(401).json({ mensagem: "Não autorizado." });
    }
    try {
        const [rows] = await pool.query("SELECT id_usuario, nome, email, cargo, telefone, foto FROM usuario WHERE id_usuario = ?", [req.session.usuario.id]);
        if (rows.length === 0) {
            return res.status(404).json({ mensagem: "Usuário não encontrado." });
        }
        res.json(rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensagem: "Erro interno no servidor." });
    }
});

router.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/login");
});

module.exports = router;
