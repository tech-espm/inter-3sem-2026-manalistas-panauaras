const express = require("express");
const router = express.Router();
const Alerta = require("../models/Alerta");
const wrap = require("express-async-error-wrapper");

router.get('/', wrap(async (req, res) => {
    res.render('index/main_dash', { pagina: 'dashboard' });
}));

router.get('/alertas', wrap(async (req, res) => {
    const kpis = await Alerta.getKPIs();
    const alertas = await Alerta.listar();
    res.render('index/central_alerta', { pagina: 'alertas', kpis, alertas });
}));

router.get('/ocupacao', (req, res) => {
    res.render('index/ocupacao', { pagina: 'ocupacao' });
});

router.get('/tendencia', (req, res) => {
    res.render('index/tendencia', { pagina: 'tendencia' });
});

router.get('/sobre', (req, res) => {
    res.render('index/sobre', { pagina: 'sobre' });
});

router.get('/profile', (req, res) => {
    res.render('index/profile', { layout: false, pagina: 'profile' });
});

module.exports = router;
