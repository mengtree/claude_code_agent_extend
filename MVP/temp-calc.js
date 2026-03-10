"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var calculator_1 = require("./skills/calculator");
var calc = new calculator_1.Calculator();
// 表达式: 125899 * 454 + 4545 - 76438
console.log('🧮 计算表达式: 125899 × 454 + 4545 - 76438\n');
// 步骤1: 125899 * 454
var step1 = calc.calculate({ operation: 'multiply', a: 125899, b: 454 });
console.log("\u6B65\u9AA41: 125899 \u00D7 454 = ".concat(step1.result));
// 步骤2: 结果 + 4545
var step2 = calc.calculate({ operation: 'add', a: step1.result, b: 4545 });
console.log("\u6B65\u9AA42: ".concat(step1.result, " + 4545 = ").concat(step2.result));
// 步骤3: 结果 - 76438
var step3 = calc.calculate({ operation: 'subtract', a: step2.result, b: 76438 });
console.log("\u6B65\u9AA43: ".concat(step2.result, " - 76438 = ").concat(step3.result));
console.log("\n\u2705 \u6700\u7EC8\u7ED3\u679C: 125899 \u00D7 454 + 4545 - 76438 = ".concat(step3.result));
