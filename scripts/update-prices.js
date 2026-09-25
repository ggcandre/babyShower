/**
 * ============================================================================
 * Atualização Automática de Preços via Web Scraping Seguro
 * ============================================================================
 * 
 * Regras:
 * 1. Só atualiza produtos que ainda têm stock disponível (não reservados a 100%).
 * 2. Extrai preços através de metadados padrão (Schema.org JSON-LD, OpenGraph, meta tags).
 * 3. Validação de Sanidade: rejeita variações absurdas (ex: >80% de diferença de um dia para o outro).
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://abrkfvebnxkpfcywyiyy.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFicmtmdmVibnhrcGZjeXd5aXl5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxNzQwMzAsImV4cCI6MjEwNTc1MDAzMH0.t1rDKh_sGfpvWTmHP7brL53k_EUp6xzKjjuP5AUuAl0';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Data limite para atualização automática de preços (20 de Novembro de 2026)
const EXPIRATION_DATE = new Date('2026-11-20T23:59:59Z');

async function fetchWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-PT,pt;q=0.9,en;q=0.8,es;q=0.7',
        'Cache-Control': 'no-cache'
      },
      redirect: 'follow'
    });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    clearTimeout(timeoutId);
    return null;
  }
}

function parsePriceFromString(val) {
  if (typeof val === 'number') return val;
  if (!val || typeof val !== 'string') return null;

  // Limpa caracteres de moeda e normaliza formatos como "39,90 €" ou "39.90"
  let cleaned = val.replace(/[^0-9.,]/g, '').trim();
  if (!cleaned) return null;

  // Se tem vírgula e ponto (ex: 1.250,50 ou 1,250.50)
  if (cleaned.includes(',') && cleaned.includes('.')) {
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      cleaned = cleaned.replace(/,/g, '');
    }
  } else if (cleaned.includes(',')) {
    cleaned = cleaned.replace(',', '.');
  }

  const num = parseFloat(cleaned);
  return (!isNaN(num) && num > 0) ? num : null;
}

function extractPriceFromHtml(html) {
  if (!html) return null;

  // 1. Procurar em blocos Schema.org JSON-LD (<script type="application/ld+json">)
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const content = JSON.parse(match[1]);
      const items = Array.isArray(content) ? content : (content['@graph'] || [content]);

      for (const item of items) {
        if (!item) continue;
        const offers = item.offers;
        if (offers) {
          const offerList = Array.isArray(offers) ? offers : [offers];
          for (const offer of offerList) {
            const p = parsePriceFromString(offer.price || offer.lowPrice || offer.highPrice);
            if (p) return p;
          }
        }
      }
    } catch (e) {
      // JSON inválido em alguns scripts, ignora e continua
    }
  }

  // 2. Procurar em Meta Tags OpenGraph / Twitter / Product
  const metaRegexList = [
    /<meta[^>]*property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']product:price:amount["']/i,
    /<meta[^>]*property=["']og:price:amount["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:price:amount["']/i,
    /<meta[^>]*itemprop=["']price["'][^>]*content=["']([^"']+)["']/i,
    /<meta[^>]*content=["']([^"']+)["'][^>]*itemprop=["']price["']/i,
    /<meta[^>]*name=["']twitter:data1["'][^>]*content=["']([^"']+)["']/i
  ];

  for (const regex of metaRegexList) {
    const metaMatch = html.match(regex);
    if (metaMatch && metaMatch[1]) {
      const p = parsePriceFromString(metaMatch[1]);
      if (p) return p;
    }
  }

  return null;
}

async function main() {
  const now = new Date();
  if (now > EXPIRATION_DATE) {
    return;
  }

  // 1. Obter produtos e reservas da base de dados
  const [productsRes, reservationsRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/products?active=eq.true&select=*`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    }),
    fetch(`${SUPABASE_URL}/rest/v1/reservations?status=in.(confirmed,pending)&select=product_id,quantity`, {
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` }
    })
  ]);

  if (!productsRes.ok || !reservationsRes.ok) {
    process.exit(1);
  }

  const products = await productsRes.json();
  const reservations = await reservationsRes.json();

  // Calcular reservas ativas
  const reservedTotals = {};
  reservations.forEach(r => {
    const id = String(r.product_id);
    reservedTotals[id] = (reservedTotals[id] || 0) + (Number(r.quantity) || 0);
  });

  // Filtrar apenas produtos que NÃO estão 100% reservados e têm purchase_url válida
  const candidates = products.filter(p => {
    const desired = Number(p.desired_quantity) || 1;
    const reserved = reservedTotals[String(p.id)] || 0;
    const available = desired - reserved;
    return available > 0 && p.purchase_url && p.purchase_url.startsWith('http');
  });

  for (const p of candidates) {
    const currentPrice = Number(p.price) || 0;
    const html = await fetchWithTimeout(p.purchase_url);
    if (!html) continue;

    const scrapedPrice = extractPriceFromHtml(html);
    if (!scrapedPrice) continue;

    // Trava de segurança: Se a diferença for > 80% do valor anterior, pode ter lido um acessório/erro
    if (currentPrice > 0) {
      const ratio = scrapedPrice / currentPrice;
      if (ratio < 0.2 || ratio > 2.5) continue;
    }

    if (Math.abs(scrapedPrice - currentPrice) > 0.01) {
      // Atualizar no Supabase
      await fetch(`${SUPABASE_URL}/rest/v1/products?id=eq.${p.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          price: scrapedPrice,
          updated_at: new Date().toISOString()
        })
      });
    }

    // Pequena pausa entre pedidos para não sobrecarregar as lojas
    await new Promise(res => setTimeout(res, 800));
  }
}

main().catch(() => {});
