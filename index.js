const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Rota principal de busca
app.post('/buscar-lutas', async (req, res) => {
  const { urlTorneio, atletas } = req.body;

  if (!urlTorneio || !atletas || atletas.length === 0) {
    return res.status(400).json({ erro: 'URL do torneio e nomes dos atletas são obrigatórios' });
  }

  try {
    // Busca a página do torneio
    const response = await axios.get(urlTorneio, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const $ = cheerio.load(response.data);
    const resultados = [];

    // Percorre os atletas informados
    for (const atletaNome of atletas) {
      if (!atletaNome.trim()) continue;

      // Procura o nome do atleta na página
      const elemento = $(`*:contains("${atletaNome.trim()}")`).first();
      
      if (elemento.length > 0) {
        // Tenta encontrar as informações da luta ao redor
        const lutaInfo = elemento.closest('tr, .fight-card, [class*="fight"]');
        
        resultados.push({
          atleta: atletaNome.trim(),
          encontrado: true,
          localizacao: 'Torneio encontrado'
        });
      } else {
        resultados.push({
          atleta: atletaNome.trim(),
          encontrado: false,
          localizacao: 'Não encontrado neste torneio'
        });
      }
    }

    res.json({
      sucesso: true,
      urlTorneio,
      resultados
    });

  } catch (error) {
    console.error('Erro ao buscar torneio:', error.message);
    res.status(500).json({
      sucesso: false,
      erro: 'Erro de comunicação com o servidor. Verifique sua conexão e tente novamente.',
      detalhe: error.message
    });
  }
});

// Rota de health check (pra saber se o servidor está no ar)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', servidor: 'BJJ Fight Finder API' });
});

app.listen(PORT, () => {
  console.log(`🚀 BJJ Fight Finder API rodando na porta ${PORT}`);
});
