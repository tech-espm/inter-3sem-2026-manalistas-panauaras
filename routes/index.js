const express = require("express");
const router = express.Router();

router.get('/', (req, res) => {
    res.render('index/main_dash', { pagina: 'dashboard' });
});

router.get('/alertas', (req, res) => {
    res.render('index/central_alerta', { pagina: 'alertas' });
});

router.get('/ocupacao', (req, res) => {
    res.render('index/ocupacao', { pagina: 'ocupacao' });
});

router.get('/tendencia', (req, res) => {
    res.render('index/tendencia', { pagina: 'tendencia' });
});

router.get('/sobre', (req, res) => {
    res.render('index/sobre', { pagina: 'sobre' });
});

module.exports = router;
