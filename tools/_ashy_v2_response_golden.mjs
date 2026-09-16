#!/usr/bin/env node

import { createEmptyGoal } from '../apps/api/src/agent/intelligence-v2/goal-contract.js';
import { analyzeFinancialResults } from '../apps/api/src/agent/intelligence-v2/financial/financial-analyzer.js';
import { buildGoldenStepResults } from '../apps/api/src/agent/intelligence-v2/financial/golden-dataset.js';
import { generateResponse } from '../apps/api/src/agent/intelligence-v2/response/response-generator.js';
import { validateNumericClaims } from '../apps/api/src/agent/intelligence-v2/response/response-validator.js';

function check(name, ok) {
	console.log(`${name}: ${ok ? 'PASS' : 'FAIL'}`);
	return ok;
}

const profitGoal = createEmptyGoal({ type: 'ANALYSIS', domain: 'PROFIT', objective: 'EXPLAIN' });
const analysis = analyzeFinancialResults({ goal: profitGoal, stepResults: buildGoldenStepResults() }).financialAnalysis;
const response = await generateResponse({ goal: profitGoal, financialAnalysis: analysis });

let pass = 0;
pass += check('Contains profit down', /baiss/i.test(response.text)) ? 1 : 0;
pass += check('Contains sales up', /ventes|33/i.test(response.text)) ? 1 : 0;
pass += check('Contains expenses up', /dépenses|100/i.test(response.text)) ? 1 : 0;
pass += check('Contains observed driver', /facteur observé/i.test(response.text)) ? 1 : 0;
pass += check('Numeric fidelity', validateNumericClaims(response.text, analysis).valid) ? 1 : 0;
pass += check('No write claim', !/j'ai ajouté/i.test(response.text)) ? 1 : 0;
pass += check('No tool names', !/get_sales|get_expenses/.test(response.text)) ? 1 : 0;

console.log(`\n${pass}/7 PASS`);
process.exit(pass === 7 ? 0 : 1);
