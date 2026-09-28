// Opt-in: faz uma chamada paga ao modelo configurado para o subagente.
// node tests/background-live.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import { repoRoot } from "./harness.mjs";

const dir = mkdtempSync(join(tmpdir(), "background-live-"));
const fixture = join(dir, "driver.ts");
// Usa o factory real no runtime real; o comando de teste despacha as ferramentas sem
// depender de o modelo principal decidir os argumentos do experimento.
writeFileSync(fixture, `import background from ${JSON.stringify(join(repoRoot, "extensions/background/index.ts"))};
export default function(pi) {
 const tools = {};
 background(new Proxy(pi, {get(target,key) {if(key === 'registerTool') return tool => {tools[tool.name]=tool; target.registerTool(tool)}; return target[key]}}));
 pi.registerCommand('bg-live', {description:'Teste local', handler: async (_,ctx) => {
   const a = await tools.background_start.execute('live-command',{command:'sleep 15; printf COMMAND_OK',timeoutSeconds:120},undefined,undefined,ctx);
   const b = await tools.background_start.execute('live-agent',{task:'Responda exatamente AGENT_OK. Não use ferramentas.',timeoutSeconds:120},undefined,undefined,ctx);
   pi.sendMessage({customType:'live-started',display:true,content:JSON.stringify([JSON.parse(a.content[0].text),JSON.parse(b.content[0].text)])},{triggerTurn:false});
 }});
 pi.registerCommand('bg-live-cancel', {description:'Teste de limpeza', handler: async (_,ctx) => {
   const a = await tools.background_start.execute('live-cleanup',{command:'sleep 90',timeoutSeconds:120},undefined,undefined,ctx);
   pi.sendMessage({customType:'live-cleanup',display:true,content:a.content[0].text},{triggerTurn:false});
 }});
}
`, { mode: 0o600 });
const child = spawn("pi", ["--mode", "rpc", "--no-session", "-ne", "-ns", "-np", "-na", "-e", fixture], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
const events = []; let buffer = "", stderr = "", exited = false;
const closed = new Promise(resolve => child.on("close", (code) => { exited = true; resolve(code); }));
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => { buffer += chunk; let n; while ((n = buffer.indexOf("\n")) !== -1) { const line = buffer.slice(0,n); buffer=buffer.slice(n+1); try { events.push(JSON.parse(line)); } catch {} } });
child.stderr.setEncoding("utf8"); child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-8000); });
const send = record => child.stdin.write(JSON.stringify(record)+"\n");
async function waitFor(predicate, seconds = 150) {
 const deadline = Date.now()+seconds*1000;
 while(Date.now()<deadline) { const value = events.find(predicate); if(value) return value; if(exited) throw new Error(`Pi saiu prematuramente: ${stderr}`); await delay(40); }
 throw new Error(`Timeout no teste real. stderr: ${stderr}`);
}
const custom = type => e => e.type === "message_end" && e.message?.customType === type;
try {
 send({id:"start",type:"prompt",message:"/bg-live"});
 const started = JSON.parse((await waitFor(custom("live-started"))).message.content);
 assert.equal(started.length,2); assert.ok(started.every(j=>j.state === "running"));
 send({id:"responsive",type:"get_state"});
 const state = await waitFor(e=>e.type === "response" && e.id === "responsive",10);
 assert.equal(state.success,true);
 console.log("Pi respondeu get_state após iniciar comando e subagente; ambos retornaram running.");
 for(const job of started) {
   const done = await waitFor(e=>custom("background-done")(e) && e.message.details.id === job.id);
   send({id:job.id,type:"prompt",message:`/jobs ${job.id}`});
   const detail = await waitFor(e=>custom("background-jobs")(e) && JSON.parse(e.message.content).id === job.id);
   const value = JSON.parse(detail.message.content);
   assert.equal(value.state,"completed",JSON.stringify({state:value.state,error:value.error,output:value.output}));
   assert.match(value.output,job.kind === "agent" ? /AGENT_OK/ : /COMMAND_OK/);
   console.log(JSON.stringify({kind:value.kind,state:value.state,output:value.output.trim(),usage:value.usage}));
 }
 send({id:"cleanup",type:"prompt",message:"/bg-live-cancel"});
 await waitFor(custom("live-cleanup"));
 child.stdin.end();
 const code = await Promise.race([closed,delay(10000).then(()=>{throw new Error("Shutdown bloqueado por tarefa background")})]);
 assert.equal(code,0);
 assert.equal(events.filter(custom("background-done")).length,2);
 console.log("Shutdown real com tarefa pendente terminou sem aviso tardio.");
} finally {
 if(!exited) { child.stdin.end(); await Promise.race([closed,delay(3000)]); if(!exited) child.kill("SIGTERM"); }
 rmSync(dir,{recursive:true,force:true});
}
