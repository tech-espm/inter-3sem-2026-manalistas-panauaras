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

    const { cargo, telefone } = req.body;
    const fotoPath = req.file ? `/public/uploads/profile/${req.file.filename}` : null;

    try {
        await pool.query(
            "UPDATE usuario SET cargo = ?, telefone = ?, foto = ? WHERE id_usuario = ?",
            [cargo, telefone, fotoPath, req.session.usuario.id]
        );

        req.session.usuario.perfilCompleto = true;
        req.session.usuario.cargo = cargo;
        req.session.usuario.foto = fotoPath;

        res.json({ mensagem: "Perfil atualizado!" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ mensagem: "Erro ao atualizar perfil." });
    }
});


router.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/login");
});

module.exports = router;
