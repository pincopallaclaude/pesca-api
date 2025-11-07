// test_kb.js
const { getKnowledgeFor } = require("./lib/domain/knowledge_base");

console.log("--- TEST LOGICO: Spigola ---");
const test1 = getKnowledgeFor("mare in scaduta dopo una mareggiata");
console.log(test1);

console.log("\n--- TEST LOGICO: Orata ---");
const test2 = getKnowledgeFor("soleggiata alta pressione");
console.log(test2);

console.log("\n--- TEST LOGICO: Nessuna Corrispondenza (Fallback) ---");
const test3 = getKnowledgeFor("trote in montagna");
console.log(test3);