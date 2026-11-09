# agente-felipe

Assistente com IA no WhatsApp **pessoal** do Felipe (designer, programador e TI). Atende quem chega querendo contratar, entende o pedido (serviço, objetivo, prazo, referências), manda o portfólio e passa a conversa para o Felipe na hora do orçamento. Amigos, família e conversas pessoais ficam **sem resposta da IA**.

Um painel web permite editar o prompt, acompanhar as conversas, assumir o atendimento e ensinar a IA.

| Peça | Serviço | Plano |
|---|---|---|
| Painel + webhooks (Next.js 16) | Vercel | Hobby (grátis) |
| Banco | Neon Postgres (Prisma 6) | Free |
| Agrupar mensagens seguidas | Upstash Redis | Free |
| E-mail do login | Gmail (senha de app) ou Resend | Grátis |
| IA | Groq → Gemini → Anthropic (opcional, paga) | Grátis |
| WhatsApp | Gateway por QR code no seu PC + túnel Cloudflare | Grátis |

```
Cliente → seu WhatsApp → gateway no PC (Baileys) → túnel Cloudflare → POST /api/webhooks/waha
  → grava no Postgres → espera 5s (junta mensagens seguidas) → regras/encaminhamento
  → IA responde, fica calada ([[IGNORAR]]) ou encaminha para você → resposta pelo gateway
```

---

## Passo a passo para colocar no ar

> **Não reaproveite o banco, o Redis nem as chaves do Gaúcho.** Este projeto precisa dos próprios. Se usar o mesmo banco, as conversas e o prompt dos dois se misturam.

### 1. Vercel: Root Directory

Vercel → projeto → **Settings → Build and Deployment → Root Directory = `apps/web`**.

Sem isso, o site abre em **404** e os arquivos do repositório ficam públicos. O `apps/web/vercel.json` já fixa o framework Next.js e o Node 24.

### 2. Banco (Neon)

1. Vercel → projeto → **Storage → Create Database → Neon** (ou *Connect* a um banco Neon novo).
2. Conecte ao projeto nos ambientes **Production** e **Preview**.
3. A integração cria sozinha `DATABASE_URL` (pooled) e `DATABASE_URL_UNPOOLED` (direta). Confira em **Settings → Environment Variables**.

### 3. Redis (Upstash)

1. https://console.upstash.com → **Create Database** (Redis, região `sa-east-1` São Paulo ou `us-east-1`).
2. Na aba **REST API**, copie a URL e o token para a Vercel:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

> Se criar pela Vercel Marketplace, os nomes vêm como `KV_REST_API_URL`/`KV_REST_API_TOKEN`. Copie os valores para os nomes acima, que são os que o código lê.

### 4. Chaves secretas

Gere quatro valores aleatórios (Git Bash):

```bash
for n in AUTH_SECRET CRON_SECRET WAHA_API_KEY WAHA_HMAC_KEY; do echo "$n=$(openssl rand -hex 32)"; done
```

Guarde a `WAHA_API_KEY`: ela vai também no `.env` do gateway (passo 8).

### 5. IA (grátis)

| Variável | Onde pegar |
|---|---|
| `GROQ_API_KEY` | https://console.groq.com/keys (IA principal) |
| `GROQ_MODEL` | `openai/gpt-oss-120b` |
| `GOOGLE_API_KEY` | https://aistudio.google.com/apikey (reserva da IA e transcrição de áudios) |
| `GEMINI_MODEL` | `gemini-2.5-flash` |
| `ANTHROPIC_API_KEY` | Opcional e pago. Só é usada se as duas grátis falharem |

### 6. Login do painel (e-mail)

| Variável | Valor |
|---|---|
| `ADMIN_EMAILS` | Seu e-mail (quem pode entrar). Vários: separados por vírgula |
| `GMAIL_USER` | Seu Gmail |
| `GMAIL_APP_PASSWORD` | Senha de app: https://myaccount.google.com/apppasswords (exige verificação em 2 etapas) |
| `APP_URL` | `https://<seu-projeto>.vercel.app` (sem `/` no final) |

### 7. Cadastrar tudo na Vercel e publicar

Resumo das variáveis em **Settings → Environment Variables** (Production):

```
APP_URL  AUTH_SECRET  ADMIN_EMAILS  CRON_SECRET
DATABASE_URL  DATABASE_URL_UNPOOLED          ← criadas pela integração Neon
UPSTASH_REDIS_REST_URL  UPSTASH_REDIS_REST_TOKEN
GMAIL_USER  GMAIL_APP_PASSWORD
GROQ_API_KEY  GROQ_MODEL  GOOGLE_API_KEY  GEMINI_MODEL
WAHA_API_KEY  WAHA_HMAC_KEY
```

Depois, crie as tabelas e os dados iniciais **a partir do seu PC**:

```bash
cd apps/web
npm install
vercel link                                  # escolha o projeto agente-felipe
vercel env pull .env --environment=production
npx prisma migrate deploy                    # cria as tabelas no Neon
npm run db:seed                              # cria o agente "Assistente Felipe" e as regras
```

> O `.env` fica fora do git (`.gitignore`). Se o `vercel env pull` não trouxer as URLs do banco, copie-as do painel da Neon (**Connection string**: pooled → `DATABASE_URL`, direta → `DATABASE_URL_UNPOOLED`).

Por fim, publique: `git push origin main` (ou **Deployments → Redeploy**). **Variável alterada na Vercel só vale depois de um novo deploy.**

Teste: `https://<seu-projeto>.vercel.app/api/health` deve responder `{"ok":true,"db":true,"redis":true}`.

### 8. Gateway do WhatsApp no seu PC

O gateway conecta o seu WhatsApp pelo QR code (como o WhatsApp Web) e roda em segundo plano no Windows.

```powershell
cd infra\wa-gateway
npm install
winget install Cloudflare.cloudflared        # se ainda não tiver
```

Crie `infra/wa-gateway/.env` (fora do git):

```
PORT=3001
WAHA_API_KEY=<a mesma da Vercel>
APP_URL=https://<seu-projeto>.vercel.app
TUNNEL=cloudflared
CLOUDFLARED_BIN=C:/Program Files (x86)/cloudflared/cloudflared.exe
```

> **`PORT=3001`:** o gateway do Gaúcho já usa a porta 3000 neste PC. Os dois rodam juntos, cada um com sua porta, sua pasta `data/` e seu número.

Ligue e deixe iniciar sozinho com o Windows:

```powershell
powershell -File install-autostart.ps1                  # cria agente-felipe-whatsapp.vbs em shell:startup
wscript "C:\Users\Brendo\Documents\DEV\agent-felipe\agente-felipe\infra\wa-gateway\start-hidden.vbs"
Get-Content data\gateway.log -Tail 20                   # deve aparecer tunnel.registered
```

### 9. Conectar o número

1. Painel → **WhatsApp**. O QR aparece sozinho (ou clique em **Conectar por QR code**).
2. No seu celular: **WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho** e escaneie.
3. O status muda para **Conectado**.

### 10. Ajustar no painel

1. **Ajustes → Você:** seu nome/marca e o link do portfólio (vira `{{LINK}}` no prompt).
2. **Ajustes → Pausa depois que você responde:** já vem em **1800 s (30 min)**. Quando você responde alguém, a IA fica calada naquela conversa por esse tempo.
3. **Agente:** revise a lista de serviços no prompt e use **Testar** (ex.: "quanto custa uma logo?", "preciso de um site pra minha loja").
4. **Aprendizado → Ensinar algo novo:** coloque o que a IA pode afirmar (faixas de preço, prazos médios, formas de pagamento, cidades que atende). Sem isso, ela nunca fala valor.
5. Teste de **outro celular**: mande "oi, preciso de um site". Deve chegar **uma** resposta.

---

## Cuidados por ser o seu número pessoal

- **Risco de bloqueio:** o QR code usa o WhatsApp Web de forma não oficial. Se o WhatsApp entender como uso abusivo, pode **banir o número**. O agente nunca inicia conversa nem envia em massa, o que reduz o risco, mas ele existe. A API oficial da Meta não tem esse risco, porém exige um número **dedicado** (ele sai do app do celular), por isso não serve para o número pessoal.
- **Quem a IA responde:** só quem fala de serviço, portfólio, orçamento ou suporte. Família, amigos, recados, pix pessoal e mensagens automáticas recebem `[[IGNORAR]]` e ficam só no painel. Na dúvida, ela fica calada.
- **Contatos próximos:** abra a conversa no painel e use **Pausar IA**. Ela não responde mais aquela pessoa até você clicar em **Reativar IA**.
- **Você responde pelo celular normalmente.** A mensagem aparece no painel como sua e pausa a IA (passo 10.2).
- **Encaminhamentos:** "falar com o Felipe", "atendente" ou um pedido de orçamento depois de explicar o projeto → a IA responde, pausa e a conversa aparece em **Precisa de você**. Depois de resolver, clique em **Resolver e reativar IA**. Os campos "WhatsApp para avisos" em Ajustes são opcionais: deixe vazios, porque a conversa já está no seu celular.
- **PC ligado:** com o PC desligado ou sem internet, o WhatsApp funciona normal no celular, mas a IA não responde. Para 24h, veja *Alternativa: VPS*.
- **Áudios:** a IA transcreve notas de voz (Gemini, com Whisper do Groq como reserva).
- **Grupos, status e canais** são ignorados.
- **Vercel Hobby** é para uso não comercial. Se o volume de clientes crescer, considere o plano Pro.

## Comandos úteis do gateway

```powershell
# Ligar manualmente (sem janela)
wscript "C:\Users\Brendo\Documents\DEV\agent-felipe\agente-felipe\infra\wa-gateway\start-hidden.vbs"

# Ver o log
Get-Content "C:\Users\Brendo\Documents\DEV\agent-felipe\agente-felipe\infra\wa-gateway\data\gateway.log" -Tail 20

# Parar SÓ o gateway deste projeto (o do Gaúcho continua)
Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -match 'agente-felipe' -and $_.CommandLine -match 'gateway\.mjs' } | ForEach-Object { Get-CimInstance Win32_Process -Filter "ParentProcessId=$($_.ProcessId)" | ForEach-Object { Stop-Process -Id $_.ProcessId } }

# Desligar o início automático: Win+R → shell:startup → apague agente-felipe-whatsapp.vbs
```

- **Sessão:** fica em `infra/wa-gateway/data/auth`. Reiniciar o PC não pede QR de novo. Se você desconectar o aparelho pelo celular, o painel volta a pedir o QR.
- **Túnel:** a URL da Cloudflare muda a cada reinício e é registrada sozinha no app (`POST /api/waha/register`). Se a internet cair, o gateway recria o túnel em até ~3 min.

## Monitoramento (opcional)

| Endpoint | 200 quando | 503 quando |
|---|---|---|
| `/api/health` | Site, banco e Redis ok | Algum caiu |
| `/api/health/whatsapp` | WhatsApp conectado | PC desligado, túnel caído ou número desconectado |

Cadastre os dois no UptimeRobot (grátis) para receber e-mail quando cair.

## Rodar localmente

```bash
cd apps/web
vercel env pull .env.local
npm install
npm run dev
```

> O `next build` precisa de mais RAM do que este PC tem livre. Deixe o build com a Vercel.

## Pastas

| Caminho | O quê |
|---|---|
| `apps/web` | App Next.js (painel + webhooks). Root Directory na Vercel |
| `apps/web/prisma/seed.ts` | Prompt inicial, regras de encaminhamento e ajustes padrão |
| `apps/web/src/lib/handoff-routes.ts` | Rotas "Falar com o Felipe" e "Orçamento" e as regras de silêncio |
| `apps/web/src/lib/flush.ts` | Decide e responde (regras, encaminhamento, IA, envio) |
| `apps/web/src/lib/llm` | Groq, Gemini, Anthropic e a cadeia de fallback |
| `infra/wa-gateway` | Gateway WhatsApp por QR code (roda no PC) |
| `infra/waha` | Alternativa: Waha + Caddy em VPS |

## Alternativa: VPS

Para o WhatsApp funcionar 24h sem o PC, use `infra/waha` (Waha Core + Caddy com HTTPS) numa VM Ubuntu:

```bash
scp -r infra/waha ubuntu@<ip>:~/waha
ssh ubuntu@<ip> 'cd ~/waha && WAHA_API_KEY=<chave> bash setup.sh'   # imprime o WAHA_BASE_URL
```

Cadastre `WAHA_BASE_URL` na Vercel. Ele tem prioridade sobre a URL registrada pelo gateway do PC.
