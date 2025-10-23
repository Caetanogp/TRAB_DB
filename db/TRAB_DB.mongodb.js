/********************************************************************************
 A) SETUP & LIMPEZA
 - Define o DB do projeto.
 - Apaga as coleções do trabalho se já existirem (idempotente).
 - Ping apenas para checar conexão.
********************************************************************************/
use('marketplace_db');

const dropIfExists = (name) => {
  const exists = db.getCollectionNames().includes(name);
  if (exists) db.getCollection(name).drop();
};
['users','categories','products','orders','reviews'].forEach(dropIfExists);

db.runCommand({ ping: 1 }); // deve retornar { ok: 1 }

/********************************************************************************
 B) VALIDAÇÃO (JSON SCHEMA) + CRIAÇÃO DAS COLLECTIONS
 - Define schemas com validação.
 - Inclui GeoJSON Point, promoções, seller_reply, snapshot em orders.
********************************************************************************/

// util: GeoJSON Point
const geoPointSchema = {
  bsonType: "object",
  required: ["type", "coordinates"],
  properties: {
    type: { enum: ["Point"] },
    coordinates: {
      bsonType: "array",
      items: [{ bsonType: "double" }, { bsonType: "double" }],
      minItems: 2, maxItems: 2
    }
  }
};

// USERS
db.createCollection('users', {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["name","email","password_hash","address","location","points_balance"],
    properties: {
      name: { bsonType: "string" },
      email:{ bsonType: "string" },
      password_hash:{ bsonType: "string" },
      address:{ bsonType: "string" },
      location: geoPointSchema,
      points_balance: { bsonType: "int", minimum: 0 }
    }
  } }
});

// CATEGORIES
db.createCollection('categories', {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["name"],
    properties: {
      name: { bsonType: "string" },
      parent_id: { bsonType: ["objectId","null"] },
      path: { bsonType: "array", items: { bsonType: "objectId" } }
    }
  } }
});

// PRODUCTS
db.createCollection('products', {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["name","price","qty","seller_id","category_id","location"],
    properties: {
      name:{ bsonType: "string" },
      description:{ bsonType: "string" },
      price:{ bsonType: "double", minimum: 0 },
      qty:{ bsonType: "int", minimum: 0 },
      seller_id:{ bsonType: "objectId" },
      category_id:{ bsonType: "objectId" },
      location: geoPointSchema,
      active_promotions: {
        bsonType: "array",
        items: {
          bsonType: "object",
          required: ["label","discount_pct","start","end"],
          properties: {
            label:{ bsonType: "string" },
            discount_pct:{ bsonType: "double", minimum:0, maximum:100 },
            start:{ bsonType:"date" },
            end:{ bsonType:"date" }
          }
        }
      }
    }
  } }
});

// ORDERS (itens incorporados: snapshot de preço/qty)
db.createCollection('orders', {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["buyer_id","status","created_at","items","loyalty_points_awarded"],
    properties: {
      buyer_id:{ bsonType:"objectId" },
      status:{ enum:["CREATED","PAID","SHIPPED","DELIVERED","CANCELED"] },
      created_at:{ bsonType:"date" },
      paid_at:{ bsonType:["date","null"] },
      items:{
        bsonType:"array", minItems:1,
        items:{ bsonType:"object",
          required:["product_id","seller_id","qty","unit_price"],
          properties:{
            product_id:{ bsonType:"objectId" },
            seller_id:{ bsonType:"objectId" },
            qty:{ bsonType:"int", minimum:1 },
            unit_price:{ bsonType:"double", minimum:0 }
          }
        }
      },
      total_amount:{ bsonType:"double", minimum:0 },
      loyalty_points_awarded:{ bsonType:"int", minimum:0 },
      buyer_location: geoPointSchema
    }
  } }
});

// REVIEWS (com possível resposta do vendedor)
db.createCollection('reviews', {
  validator: { $jsonSchema: {
    bsonType: "object",
    required: ["user_id","product_id","order_id","rating","comment","created_at"],
    properties: {
      user_id:{ bsonType:"objectId" },
      product_id:{ bsonType:"objectId" },
      order_id:{ bsonType:"objectId" },
      rating:{ bsonType:"int", minimum:1, maximum:5 },
      comment:{ bsonType:"string" },
      created_at:{ bsonType:"date" },
      seller_reply:{
        bsonType:["object","null"],
        properties:{ replied_at:{ bsonType:"date" }, message:{ bsonType:"string" } }
      }
    }
  } }
});

/********************************************************************************
 C) INSERTS (≥5 por coleção)
 - Popula users, categories (hierarquia), products, orders, reviews.
********************************************************************************/
use('marketplace_db');

// USERS
const users = [
  { name:"Ana Vendedora", email:"ana@ex.com", password_hash:"hash1", address:"Rua A, 100", location:{type:"Point", coordinates:[-46.6388,-23.5489]}, points_balance: 100 },
  { name:"Bruno Comprador", email:"bruno@ex.com", password_hash:"hash2", address:"Rua B, 200", location:{type:"Point", coordinates:[-43.2096,-22.9035]}, points_balance: 20 },
  { name:"Carla Usuária", email:"carla@ex.com", password_hash:"hash3", address:"Rua C, 300", location:{type:"Point", coordinates:[-51.2300,-30.0331]}, points_balance: 0 },
  { name:"Diego Seller", email:"diego@ex.com", password_hash:"hash4", address:"Rua D, 400", location:{type:"Point", coordinates:[-38.5220,-12.9718]}, points_balance: 55 },
  { name:"Erika Buyer", email:"erika@ex.com", password_hash:"hash5", address:"Rua E, 500", location:{type:"Point", coordinates:[-48.5480,-27.5954]}, points_balance: 70 }
];
const userIds = db.users.insertMany(users).insertedIds;

// CATEGORIES
const catRoot = db.categories.insertOne({ name:"Eletrônicos", parent_id: null, path: [] }).insertedId;
const catPhones = db.categories.insertOne({ name:"Celulares", parent_id: catRoot, path:[catRoot] }).insertedId;
const catAudio  = db.categories.insertOne({ name:"Áudio", parent_id: catRoot, path:[catRoot] }).insertedId;
const catGames  = db.categories.insertOne({ name:"Games", parent_id: catRoot, path:[catRoot] }).insertedId;
const catTV     = db.categories.insertOne({ name:"TVs", parent_id: catRoot, path:[catRoot] }).insertedId;

// PRODUCTS
const products = [
  { name:"Smartphone X", description:"6.1\" 128GB", price: 2500.00, qty: 12, seller_id: userIds[0], category_id: catPhones, location:{type:"Point", coordinates:[-46.63,-23.55]}, active_promotions: [] },
  { name:"Headset Pro", description:"Som 7.1", price: 600.00, qty: 30, seller_id: userIds[3], category_id: catAudio,  location:{type:"Point", coordinates:[-43.20,-22.90]}, active_promotions: [] },
  { name:"Console Z", description:"Edição 1TB", price: 3500.00, qty: 7, seller_id: userIds[0], category_id: catGames,  location:{type:"Point", coordinates:[-46.64,-23.55]}, active_promotions: [] },
  { name:"Smart TV 55\"", description:"4K HDR", price: 3200.00, qty: 5, seller_id: userIds[3], category_id: catTV,     location:{type:"Point", coordinates:[-38.52,-12.97]}, active_promotions: [] },
  { name:"Fone Bluetooth", description:"AAC, estojo", price: 280.00, qty: 40, seller_id: userIds[0], category_id: catAudio, location:{type:"Point", coordinates:[-51.23,-30.03]}, active_promotions: [] }
];
const prodIds = db.products.insertMany(products).insertedIds;

// ORDERS
const orders = [
  {
    buyer_id: userIds[1], status:"DELIVERED", created_at:new Date("2025-10-01T10:00:00Z"), paid_at:new Date("2025-10-01T10:05:00Z"),
    items:[{ product_id: prodIds[0], seller_id: userIds[0], qty:1, unit_price:2500.00 }],
    total_amount: 2500.00, loyalty_points_awarded: 250, buyer_location: db.users.findOne({_id:userIds[1]}).location
  },
  {
    buyer_id: userIds[2], status:"PAID", created_at:new Date("2025-10-05T12:00:00Z"), paid_at:new Date("2025-10-05T12:01:00Z"),
    items:[{ product_id: prodIds[1], seller_id: userIds[3], qty:2, unit_price:600.00 }],
    total_amount: 1200.00, loyalty_points_awarded: 120, buyer_location: db.users.findOne({_id:userIds[2]}).location
  },
  {
    buyer_id: userIds[4], status:"DELIVERED", created_at:new Date("2025-10-10T09:00:00Z"), paid_at:new Date("2025-10-10T09:03:00Z"),
    items:[{ product_id: prodIds[2], seller_id: userIds[0], qty:1, unit_price:3500.00 }],
    total_amount: 3500.00, loyalty_points_awarded: 350, buyer_location: db.users.findOne({_id:userIds[4]}).location
  },
  {
    buyer_id: userIds[1], status:"CREATED", created_at:new Date("2025-10-12T17:00:00Z"), paid_at:null,
    items:[{ product_id: prodIds[4], seller_id: userIds[0], qty:1, unit_price:280.00 }],
    total_amount: 280.00, loyalty_points_awarded: 28, buyer_location: db.users.findOne({_id:userIds[1]}).location
  },
  {
    buyer_id: userIds[2], status:"DELIVERED", created_at:new Date("2025-10-20T15:00:00Z"), paid_at:new Date("2025-10-20T15:05:00Z"),
    items:[{ product_id: prodIds[3], seller_id: userIds[3], qty:1, unit_price:3200.00 }],
    total_amount: 3200.00, loyalty_points_awarded: 320, buyer_location: db.users.findOne({_id:userIds[2]}).location
  }
];
const orderIds = db.orders.insertMany(orders).insertedIds;

// REVIEWS
const reviews = [
  { user_id:userIds[1], product_id:prodIds[0], order_id:orderIds[0], rating:5, comment:"Excelente!", created_at:new Date("2025-10-02T10:00:00Z"), seller_reply:null },
  { user_id:userIds[2], product_id:prodIds[1], order_id:orderIds[1], rating:4, comment:"Bom custo-benefício.", created_at:new Date("2025-10-06T09:00:00Z"), seller_reply:null },
  { user_id:userIds[4], product_id:prodIds[2], order_id:orderIds[2], rating:5, comment:"Top demais.", created_at:new Date("2025-10-11T08:00:00Z"), seller_reply:null },
  { user_id:userIds[1], product_id:prodIds[4], order_id:orderIds[3], rating:3, comment:"Ok pelo preço.", created_at:new Date("2025-10-13T18:00:00Z"), seller_reply:null },
  { user_id:userIds[2], product_id:prodIds[3], order_id:orderIds[4], rating:4, comment:"Imagem ótima.", created_at:new Date("2025-10-21T12:00:00Z"), seller_reply:null }
];
db.reviews.insertMany(reviews);

// checagens rápidas (espera 5 em cada)
db.users.countDocuments();
db.categories.countDocuments();
db.products.countDocuments();
db.orders.countDocuments();
db.reviews.countDocuments();

/********************************************************************************
 D) ÍNDICES (inclui 2dsphere)
 Justificativas-padrão usadas:
 - Frequência: quão comum é o padrão na aplicação (telas/relatórios).
 - Cardinalidade: quantidade de valores distintos no(s) campo(s) (baixa/média/alta).
 - Seletividade: o quanto o filtro reduz o conjunto (quanto menor o % retornado, melhor).

 Objetivo geral:
 - Catálogo rápido por categoria com ordenação por preço.
 - Busca textual sem varrer coleção inteira.
 - Joins frequentes e relatórios com bom custo.
 - Geo com proximidade e filtro por área (2dsphere obrigatório).
********************************************************************************/
use('marketplace_db');

/* Catálogo por categoria + ordenação por preço
   - Frequência: muito alta (listagem principal por categoria).
   - Cardinalidade: category_id média/alta; price contínuo.
   - Seletividade: boa ao filtrar por category_id; o sort por price é atendido no índice (evita SORT em memória). */
db.products.createIndex({ category_id: 1, price: 1 });

/* Busca textual por nome/descrição
   - Frequência: alta (busca por palavra-chave).
   - Cardinalidade: alta (muitos termos e combinações).
   - Seletividade: boa para termos específicos; evita COLLSCAN em $text. */
db.products.createIndex({ name: "text", description: "text" });

/* Navegação por vendedor (meus produtos / vitrine do vendedor)
   - Frequência: média/alta (páginas do vendedor e relatórios).
   - Cardinalidade: alta (muitos vendedores).
   - Seletividade: boa (filtro exato por seller_id). */
db.products.createIndex({ seller_id: 1 });

/* Detalhe do produto → reviews do produto
   - Frequência: alta (toda página de produto).
   - Cardinalidade: alta (muitos produtos).
   - Seletividade: ótima (product_id exato). */
db.reviews.createIndex({ product_id: 1 });

/* Histórico de avaliações por usuário (perfil/auditoria)
   - Frequência: média.
   - Cardinalidade: alta (muitos usuários).
   - Seletividade: ótima (user_id exato). */
db.reviews.createIndex({ user_id: 1 });

/* Timeline de pedidos por comprador
   - Frequência: média (meus pedidos).
   - Cardinalidade: alta (muitos compradores).
   - Seletividade: boa (buyer_id); ordenação por created_at DESC coberta no índice. */
db.orders.createIndex({ buyer_id: 1, created_at: -1 });

/* Painéis/monitoramento por status ao longo do tempo
   - Frequência: média/alta (backoffice).
   - Cardinalidade: status baixa (poucos valores); combinado com data fica seletivo.
   - Seletividade: boa com filtro status + intervalo de datas; sort por data coberto. */
db.orders.createIndex({ status: 1, created_at: -1 });

/* Geolocalização de usuários (necessário para $near/$geoWithin)
   - Frequência: média (casos de proximidade de usuários).
   - Observação: 2dsphere é obrigatório para consultas geoespaciais. */
db.users.createIndex({ location: "2dsphere" });

/* Geolocalização de produtos (proximidade e relatórios por área)
   - Frequência: alta (buscar produtos próximos; H1/H3).
   - Observação: 2dsphere é obrigatório para $near e $geoWithin. */
db.products.createIndex({ location: "2dsphere" });

/********************************************************************************
 E) CONSULTAS BÁSICAS
 E1: Produtos por categoria (com explain para mostrar uso de índice composto).
 E2: Avaliações de um produto (com $lookup do nome do reviewer).
 E3: Criar transação + atualizar estoque + pontos.
 E4: Atualizar estoque (variação isolada).
********************************************************************************/

// E1 — produtos por categoria (Áudio), ordenados por preço (índice atende sort)
use('marketplace_db');
const cat = db.categories.findOne({ name: "Áudio" });
db.products.find({ category_id: cat._id }, { name:1, price:1, qty:1, seller_id:1 }).sort({ price: 1 });
db.products.find({ category_id: cat._id }).sort({ price: 1 }).explain("executionStats");

// E2 — avaliações do produto "Headset Pro" (simples + com nome do avaliador)
use('marketplace_db');
const p = db.products.findOne({ name: "Headset Pro" });
db.reviews.find({ product_id: p._id });
db.reviews.aggregate([
  { $match: { product_id: p._id } },
  { $lookup: { from: "users", localField: "user_id", foreignField: "_id", as: "u" } },
  { $unwind: "$u" },
  { $project: { _id: 0, rating: 1, comment: 1, created_at: 1, reviewer: "$u.name" } },
  { $sort: { created_at: -1 } }
]);

// E3 — criar nova compra (Bruno compra 1x Fone Bluetooth) + estoque + pontos
use('marketplace_db');
const buyer = db.users.findOne({ email: "bruno@ex.com" });
const prodForOrder  = db.products.findOne({ name: "Fone Bluetooth" });
const qty = 1;
if (!prodForOrder || prodForOrder.qty < qty) throw new Error("Estoque insuficiente ou produto não encontrado.");
const total  = prodForOrder.price * qty;
const points = Math.floor(total * 0.10);
const ins = db.orders.insertOne({
  buyer_id: buyer._id,
  status: "PAID",
  created_at: new Date(),
  paid_at: new Date(),
  items: [{ product_id: prodForOrder._id, seller_id: prodForOrder.seller_id, qty, unit_price: prodForOrder.price }],
  total_amount: total,
  loyalty_points_awarded: points,
  buyer_location: buyer.location
});
db.products.updateOne({ _id: prodForOrder._id }, { $inc: { qty: -qty } });
db.users.updateOne({ _id: buyer._id }, { $inc: { points_balance: points } });
({ orderId: ins.insertedId, novoEstoque: db.products.findOne({ _id: prodForOrder._id }, { qty:1 }).qty,
   pontosComprador: db.users.findOne({ _id: buyer._id }, { points_balance:1 }).points_balance });

// E4 — variação: debitar estoque de "Smartphone X"
use('marketplace_db');
const prodStock = db.products.findOne({ name: "Smartphone X" });
const saida = 2;
if (!prodStock || prodStock.qty < saida) throw new Error("Estoque insuficiente ou produto não encontrado.");
db.products.updateOne({ _id: prodStock._id }, { $inc: { qty: -saida } });
db.products.findOne({ _id: prodStock._id }, { name:1, qty:1 });

/********************************************************************************
 F) AGREGAÇÕES
 F1: média de rating por produto.
 F2: total de vendas por categoria (quantidade e receita).
 F3: relatório de vendas por vendedor (quantidade e receita).
********************************************************************************/

// F1 — média de avaliação por produto
use('marketplace_db');
db.reviews.aggregate([
  { $group: { _id: "$product_id", avgRating: { $avg: "$rating" }, count: { $sum: 1 } } },
  { $lookup: { from: "products", localField: "_id", foreignField: "_id", as: "p" } },
  { $unwind: "$p" },
  { $project: { _id: 0, product: "$p.name", avgRating: { $round: ["$avgRating", 2] }, count: 1 } },
  { $sort: { avgRating: -1, count: -1 } }
]);

// F2 — vendas por categoria (qtd/receita)
use('marketplace_db');
db.orders.aggregate([
  { $unwind: "$items" },
  { $lookup: { from: "products", localField: "items.product_id", foreignField: "_id", as: "prod" } },
  { $unwind: "$prod" },
  { $group: {
      _id: "$prod.category_id",
      receita: { $sum: { $multiply: ["$items.unit_price", "$items.qty"] } },
      quantidade: { $sum: "$items.qty" }
  }},
  { $lookup: { from: "categories", localField: "_id", foreignField: "_id", as: "cat" } },
  { $unwind: "$cat" },
  { $project: { _id: 0, categoria: "$cat.name", receita: 1, quantidade: 1 } },
  { $sort: { receita: -1 } }
]);

// F3 — vendas por vendedor (qtd/receita)
use('marketplace_db');
db.orders.aggregate([
  { $unwind: "$items" },
  { $group: {
      _id: "$items.seller_id",
      receita: { $sum: { $multiply: ["$items.unit_price", "$items.qty"] } },
      quantidade: { $sum: "$items.qty" }
  }},
  { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "seller" } },
  { $unwind: "$seller" },
  { $project: { _id: 0, vendedor: "$seller.name", receita: 1, quantidade: 1 } },
  { $sort: { receita: -1 } }
]);

/********************************************************************************
 G) EVOLUÇÃO DO PROJETO (SPRINT 2)
 - Promoções temporárias: push em products.active_promotions.
 - Sistema de pontos: garante points_balance (já obrigatório no schema; aqui é no-op).
 - Respostas a avaliações: preenche seller_reply em uma review sem resposta.
********************************************************************************/

// G1 — promoção ativa (Headset Pro, 15% entre 01–15/11/2025)
use('marketplace_db');
const head = db.products.findOne({ name: "Headset Pro" });
if (head) {
  db.products.updateOne(
    { _id: head._id },
    { $push: {
        active_promotions: {
          label: "Semana do Áudio",
          discount_pct: 15,
          start: new Date("2025-11-01T00:00:00Z"),
          end:   new Date("2025-11-15T23:59:59Z")
        }
    }}
  );
}

// G2 — garantir campo points_balance (no nosso dataset, todos já têm)
use('marketplace_db');
db.users.updateMany(
  { points_balance: { $exists: false } },
  { $set: { points_balance: 0 } }
);

// G3 — responder a uma avaliação sem resposta
use('marketplace_db');
const r = db.reviews.findOne({ seller_reply: null });
if (r) {
  db.reviews.updateOne(
    { _id: r._id },
    { $set: { seller_reply: { replied_at: new Date(), message: "Obrigado pelo feedback! 🙌" } } }
  );
  db.reviews.findOne({ _id: r._id });
}

/********************************************************************************
 G4) Compra com resgate de pontos de fidelidade
 - Usa até 20% do total em pontos (1 ponto = R$1 de desconto, ajuste se quiser).
 - Debita do saldo do usuário e registra o desconto aplicado no pedido.
********************************************************************************/
use('marketplace_db');

const buyerRedeem = db.users.findOne({ email: "bruno@ex.com" });
const prodRedeem  = db.products.findOne({ name: "Smartphone X" });
const qtyRedeem   = 1;

if (!prodRedeem || prodRedeem.qty < qtyRedeem) {
  throw new Error("Estoque insuficiente ou produto não encontrado para resgate.");
}

const totalBruto   = prodRedeem.price * qtyRedeem;
const limitePerc   = 0.20;                    // cap de 20% do valor
const limiteValor  = Math.floor(totalBruto * limitePerc);
const podeUsar     = Math.min(buyerRedeem.points_balance, limiteValor);
const descontoUsado= podeUsar;                // 1 ponto = R$1
const totalLiquido = totalBruto - descontoUsado;

// cria a ordem com campo "discount_points_used"
const insRedeem = db.orders.insertOne({
  buyer_id: buyerRedeem._id,
  status: "PAID",
  created_at: new Date(),
  paid_at: new Date(),
  items: [{ product_id: prodRedeem._id, seller_id: prodRedeem.seller_id, qty: qtyRedeem, unit_price: prodRedeem.price }],
  total_amount: totalLiquido,
  loyalty_points_awarded: Math.floor(totalLiquido * 0.10), // pontos sobre o líquido (política)
  buyer_location: buyerRedeem.location,
  discount_points_used: descontoUsado
});

// estoque e pontos: debita usados e credita pelos pontos da compra líquida
db.products.updateOne({ _id: prodRedeem._id }, { $inc: { qty: -qtyRedeem } });
db.users.updateOne(
  { _id: buyerRedeem._id },
  {
    $inc: {
      points_balance: Math.floor(totalLiquido * 0.10) - descontoUsado
    }
  }
);

// conferência do resgate
({
  orderId: insRedeem.insertedId,
  totalBruto,
  descontoUsado,
  totalLiquido,
  novoEstoque: db.products.findOne({ _id: prodRedeem._id }, { qty: 1 }).qty,
  pontosComprador: db.users.findOne({ _id: buyerRedeem._id }, { points_balance: 1 }).points_balance
});


/********************************************************************************
 H) CONSULTAS AVANÇADAS (GEOSPATIAL)
 H1: produtos próximos ao usuário (find + $near).
 H2: média de distância comprador↔vendedor (Haversine via $function).
 H3: categoria mais vendida numa área (versão CORRIGIDA usando $geoWithin + $centerSphere).
********************************************************************************/

// H1 — produtos perto do Bruno (raio 20km)
use('marketplace_db');
const bruno = db.users.findOne({ email: "bruno@ex.com" });
db.products.find({
  location: {
    $near: {
      $geometry: bruno.location,
      $maxDistance: 20000 // 20 km
    }
  }
}, { name: 1, price: 1, location: 1 }).limit(10);

// H2 — média de distância comprador↔vendedor (ordens entregues)
use('marketplace_db');
db.orders.aggregate([
  { $match: { status: "DELIVERED" } },
  { $unwind: "$items" },
  { $lookup: { from: "products", localField: "items.product_id", foreignField: "_id", as: "prod" } },
  { $unwind: "$prod" },
  { $addFields: { buyerCoord: "$buyer_location.coordinates", sellerCoord: "$prod.location.coordinates" } },
  { $addFields: {
      distanceKm: {
        $function: {
          body: function (buyer, seller) {
            function toRad(d){ return d * Math.PI/180; }
            const R = 6371;
            const dLat = toRad(seller[1]-buyer[1]);
            const dLon = toRad(seller[0]-buyer[0]);
            const lat1 = toRad(buyer[1]);
            const lat2 = toRad(seller[1]);
            const a = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
            return 2 * R * Math.asin(Math.sqrt(a));
          },
          args: ["$buyerCoord","$sellerCoord"],
          lang: "js"
        }
      }
  }},
  { $group: { _id: null, avgDistanceKm: { $avg: "$distanceKm" }, amostras: { $sum: 1 } } },
  { $project: { _id: 0, avgDistanceKm: { $round: ["$avgDistanceKm", 2] }, amostras: 1 } }
]);

// H3 (CORRIGIDO) — categoria mais vendida num raio de 30 km do Rio
use('marketplace_db');
const center = { type: "Point", coordinates: [-43.2096, -22.9035] };
const radiusKm = 30;
const radiusRad = radiusKm / 6371; // km -> radianos

db.orders.aggregate([
  { $unwind: "$items" },
  { $lookup: { from: "products", localField: "items.product_id", foreignField: "_id", as: "prod" } },
  { $unwind: "$prod" },
  { $match: {
      "prod.location": {
        $geoWithin: { $centerSphere: [ center.coordinates, radiusRad ] }
      }
  }},
  { $group: {
      _id: "$prod.category_id",
      qtd: { $sum: "$items.qty" },
      receita: { $sum: { $multiply: ["$items.unit_price", "$items.qty"] } }
  }},
  { $sort: { qtd: -1, receita: -1 } },
  { $limit: 1 },
  { $lookup: { from: "categories", localField: "_id", foreignField: "_id", as: "cat" } },
  { $unwind: "$cat" },
  { $project: { _id: 0, categoria: "$cat.name", qtd: 1, receita: 1 } }
]);

/*** Fim do script ***/
