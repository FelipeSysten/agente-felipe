# agente-gaucho

Agente de vendas no WhatsApp que atende clientes e encaminha o link do delivery. Um painel web permite editar o prompt, acompanhar as conversas e assumir o atendimento.

- **Painel:** https://agente-gaucho.vercel.app
- **Canais:** dois, que funcionam juntos. Cada cliente é respondido pelo canal por onde escreveu.
  - **WhatsApp por QR code:** gateway rodando no seu PC.
  - **WhatsApp API oficial da Meta:** Cloud API.
- **Custo zero:** Next.js 16 na Vercel Hobby, Postgres no Neon (criado pela integração da Vercel), Redis no Upstash, e-mail no Resend e IA em cadeia **Gemini → Groq → Anthropic**. A Anthropic é opcional e só é usada (e cobrada) se as duas gratuitas falharem.

> A Vercel Hobby é para uso não comercial. Para operar o delivery de verdade, migre para o Pro.

## Situação atual

| Item | Status |
|---|---|
| Painel, banco, Redis | ✅ No ar |
| Login por e-mail | ✅ Enviado pelo Gmail (`systen3@gmail.com`) para os dois admins |
| IA (Groq `openai/gpt-oss-120b` → Gemini `gemini-2.5-flash` → Anthropic) | ✅ Groq é a principal desde 21/10 |
| Anthropic (último fallback) | ⚠️ A chave precisa de `ANTHROPIC_WORKSPACE_ID`. Sem ele, a cadeia termina no Groq |
| WhatsApp por QR code | ✅ Gateway rodando no PC. Falta escanear o QR no painel |
| WhatsApp API oficial | ⏳ Falta o token permanente de System User da Meta (começa com `EAA`) |

## Login no painel

Há duas formas de entrar:

- **Login e senha:** o login (ex.: `lana`) ou o e-mail, mais a senha. Depois de 5 tentativas erradas num minuto, aquele login fica bloqueado até o minuto acabar.
- **Link por e-mail:** válido por 15 minutos e de uso único. Serve para quem ainda não tem senha.

**Quem é administrador:** os e-mails da `ADMIN_EMAILS` e as pessoas cadastradas em **Ajustes → Acesso ao painel**. Nessa tela:

- **Criar login e senha:** quem só está na `ADMIN_EMAILS` cria o próprio login e senha; quem já tem senha troca por ali.
- **Adicionar e remover:** você cadastra outra pessoa (nome, login, e-mail e senha). Sem senha informada, o painel gera uma provisória e mostra uma única vez. Quem está na `ADMIN_EMAILS` só sai do acesso editando a variável na Vercel.
- **Senhas:** ficam salvas com hash (scrypt) na tabela `AdminUser`. Ninguém consegue ler a senha, nem pelo banco.

| Variável (Vercel) | Para que serve |
|---|---|
| `ADMIN_EMAILS` | **Quem pode entrar pelo e-mail**, separados por vírgula. Hoje: `systen3@gmail.com,rogerio@gauchocafeepizzaria.com,mirandaislana15@gmail.com,lana@gauchocafeepizzaria.com` |
| `GMAIL_USER` + `GMAIL_APP_PASSWORD` | **Como o e-mail sai.** Se preenchidos, o envio usa o Gmail e chega a qualquer destinatário (limite de ~500 por dia) |
| `AUTH_EMAIL_FROM` | Remetente do Resend, usado só quando o Gmail não está configurado. **Não é a lista de quem entra.** Deve ficar `onboarding@resend.dev` |

- **Com Resend:** com o remetente de teste `onboarding@resend.dev`, o Resend só entrega para o e-mail dono da conta Resend. Ele também não aceita remetente `@gmail.com`: esse foi o erro "Não consegui enviar o e-mail agora".
- **Senha de app do Gmail:** exige a verificação em duas etapas ativa. Gere em https://myaccount.google.com/apppasswords, cadastre na Vercel como `GMAIL_APP_PASSWORD` e refaça o deploy.
- **Alterou alguma variável na Vercel?** Ela só passa a valer depois de um novo deploy.

## Monitoramento (alerta de queda)

Dois endpoints públicos, que mostram só o estado (nunca URLs ou chaves):

| Endpoint | 200 quando | 503 quando |
|---|---|---|
| `/api/health` | Site, banco (Neon) e Redis (Upstash) ok | Algum deles caiu |
| `/api/health/whatsapp` | Todo canal configurado está **conectado** | PC desligado, sem internet, túnel caído, número desconectado (precisa de QR) ou token da Meta inválido. O campo `reason` diz qual |

**UptimeRobot (grátis):** conta `systen3@gmail.com`, com os monitores "Agente Gaúcho — WhatsApp" e "Agente Gaúcho — Site". Checam a cada 5 min e mandam e-mail quando cai e quando volta. Foram criados pela API com a `UPTIMEROBOT_API_KEY` (em `.secrets`).

- **Notebook:** em *Configurações de energia → Escolher a função de fechar a tampa*, deixe **"Não fazer nada" quando conectado**. A suspensão e a hibernação por inatividade já estão em "nunca".

## Encaminhamentos (atendimento e reservas)

Quando o cliente pede algo que a IA não deve resolver sozinha, o agente encaminha a conversa:
- **Resposta:** manda ao cliente a resposta da rota.
- **Pausa:** pausa a IA naquela conversa.
- **Aviso à equipe:** avisa o WhatsApp da rota, com o nome, o número e a mensagem do cliente.

| Rota | Quando dispara | Avisa |
|---|---|---|
| **Atendimento** | "atendente", "humano", "reclamação"… ou a IA entende que o cliente quer falar com uma pessoa | WhatsApp do atendente (Configurações) |
| **Reservas de mesa** | "reserva", "reservar", "agendar mesa"… ou a IA entende que é reserva (ex.: "tem lugar pra 6 no sábado?") | `5573999091977` (Configurações) |

- **Duas formas de disparar:** palavra-chave, que é instantânea, ou a própria IA, que reconhece o pedido sem palavra-chave. A regra que a IA segue é acrescentada automaticamente ao prompt, sem alterar o texto editado no painel.
- **Reativar a IA:** no painel, a conversa aparece como "Aguardando reservas" ou "Aguardando atendente". Depois de resolvido, clique em **Resolver e reativar IA**.
- **Mensagens da equipe:** o que chega dos números de atendimento e de reservas nunca é respondido pela IA. A comparação aceita o número com ou sem o nono dígito.
- **Número compartilhado:** o mesmo número também recebe conversas pessoais e de outro negócio. Quando a mensagem claramente não é de um cliente do restaurante (recado para alguém pelo nome, "Fulano já saiu?", pix de outro assunto, resposta automática de outra empresa), a IA **fica calada** e a mensagem fica no painel. Cumprimentos e dúvidas sobre cardápio, entrega ou pedido sempre são respondidos, mesmo citando o nome de alguém ("Oi Felipe, quero uma pizza").
- **Atendimento pela IA:** a IA só encaminha para atendimento se o cliente **pedir explicitamente** uma pessoa ou reclamar de um pedido ou entrega.
- **Contato pessoal:** para a IA nunca responder alguém, abra a conversa e use **Pausar IA**. A pausa fica até você clicar em **Reativar IA**.
- **Nono dígito:** o gateway verifica se o número da equipe está registrado com ou sem o 9 (ex.: `5573 9 9909-1977` ou `557399091977`) e envia para o formato certo.
- **Onde editar:** palavras, números e mensagens ficam em **Configurações** no painel.

## Aprendizado (a IA melhora com a equipe)

A IA aprende com as respostas reais da equipe. Painel → **Aprendizado**.

| De onde vem | Como vira conhecimento |
|---|---|
| Atendente responde um cliente (celular, WhatsApp Web ou painel) | Pergunta do cliente + resposta do atendente viram **sugestão**. Várias mensagens seguidas do atendente (até 3 min) entram numa resposta só |
| **Corrigir esta resposta**, abaixo de cada resposta da IA na conversa | Vira lição **já aprovada** |
| **Ensinar algo novo**, na página Aprendizado | Lição já aprovada (horário, pagamento, taxa por bairro…) |

- **Revise antes de aprovar:** o número também recebe conversas pessoais. Ajuste o texto para servir a qualquer cliente (tire nomes e valores de um pedido específico) ou descarte. O menu mostra quantas sugestões estão pendentes.
- **Como a IA usa:** só as **aprovadas** entram no prompt, e na mensagem seguinte já valem. Com até 30 lições, todas entram. Acima disso, entram as 15 mais parecidas com o que o cliente escreveu.
- **Atualizar:** edite ou exclua em "O que a IA já sabe" quando algo mudar (ex.: horário).
- **Regra de fatos:** horário, preço, taxa, pagamento e sabores só valem se estiverem no prompt ou numa lição aprovada. Fora disso, a IA manda o link ou oferece um atendente, em vez de inventar. Ainda pode escapar em perguntas "óbvias" (ex.: "fazem meio a meio?" → "Sim!"). A forma de corrigir é ensinar a resposta certa.

## Atendente humano na conversa

Qualquer pessoa da equipe pode responder o cliente direto pelo **celular** ou pelo **WhatsApp Web** do número do bot, além do painel.

- **No painel:** a mensagem aparece na conversa como **Atendente**. A conversa se atualiza sozinha a cada 5s, e a lista de conversas a cada 10s.
- **Pausa da IA:** cada mensagem do atendente deixa a IA **calada por 30 segundos** naquela conversa, e a contagem recomeça a cada nova mensagem. Durante a pausa, a conversa mostra "⏸ IA em pausa até HH:MM:SS". Depois a IA volta sozinha. A duração fica em **Configurações → Pausa quando o atendente responde**; 0 desliga a pausa.
- **IA calada de vez:** para isso, use **Pausar IA** na conversa e depois **Reativar IA**.
- **IA x atendente:** o gateway distingue o que a IA enviou do que uma pessoa escreveu. O que sai pela API volta como eco e é ignorado.
- **Limitações:**
  - Mensagens que o atendente mandar com o gateway desligado (PC desligado) não aparecem no painel.
  - Na API oficial da Meta, o número não pode ser usado no app do celular, então lá o atendente responde só pelo painel.

## Áudios (notas de voz)

O agente transcreve os áudios do cliente e responde como se fossem texto.

- **Caminho:** o gateway baixa a nota de voz e a envia ao app junto com a mensagem. O app transcreve com o **Gemini** e, se ele falhar ou estourar a cota, com o **Whisper do Groq**. Os dois são gratuitos.
- **Histórico e painel:** a transcrição fica gravada como `🎤 (áudio) …` e aparece assim no painel. As palavras-chave e os encaminhamentos valem para áudio também: "quero reservar uma mesa", falado, encaminha para reservas.
- **Áudio que não deu para entender:** o agente pede com gentileza para o cliente repetir ou escrever.
- **Limites:** até cerca de 3 MB por áudio no canal QR (uns 10 minutos de voz; o limite vem da Vercel). Na API oficial, até 20 MB.
- **Por que o Gemini vem primeiro:** em silêncio ou ruído, o Whisper "inventa" frases (ex.: "E aí"). Quando o Gemini está indisponível, isso pode acontecer, e o agente responde algo genérico.
- **Cota gratuita do Gemini:** é limitada por minuto e por dia. Se estourar, tanto a transcrição quanto as respostas caem automaticamente no Groq.

## Como funciona

```
Cliente ─┬─ WhatsApp (QR) → gateway no PC → túnel Cloudflare → POST /api/webhooks/waha            (HMAC-SHA512)
         └─ API oficial   → Meta                          → POST /api/webhooks/whatsapp-cloud  (HMAC-SHA256)
   → dedup por id da mensagem → grava no Postgres
   → after(): debounce de 5s no Redis (msgs em sequência viram 1 resposta)
   → regras (palavra "atendente" → transfere e pausa a IA)
   → LLM com fallback → resposta pelo MESMO canal
```

## WhatsApp por QR code (gateway no PC)

`infra/wa-gateway` é um serviço Node leve, baseado no [Baileys](https://github.com/WhiskeySockets/Baileys): usa cerca de 100 MB de RAM, roda direto no Windows (sem Docker nem WSL) e fala o mesmo subconjunto da API do Waha que o app usa.

### Conectar o número (uma vez)

1. Abra o painel → **Canais WhatsApp**. O QR aparece sozinho; se não aparecer, clique em **Conectar por QR code**.
2. No celular do número do delivery: **WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho** e escaneie.
3. O status muda para **Conectado**. De **outro** celular, mande "oi", "tudo bem?" e "quero pedir" seguidos: deve chegar **uma** resposta com o link do delivery.

### Trocar de número

Cada conversa do QR code pertence ao número em que aconteceu (coluna `Conversation.line`, sem o nono dígito). O painel e o resumo de "Hoje" mostram só as conversas do número conectado agora, guardado em `AppSettings.wahaLine`.

- **Ao trocar de número:** as conversas do número anterior **somem do painel**. Elas continuam no banco e voltam a aparecer se aquele número for reconectado.
- **Mesmo cliente nos dois números:** o cliente que já falava com o número antigo começa uma **conversa nova** no número novo.
- **Sem número conectado:** o painel não mostra nenhuma conversa do QR. As da API oficial da Meta continuam visíveis.
- **Detecção:** o número conectado é atualizado quando o gateway avisa que a sessão conectou ou caiu, e também quando o painel consulta o status.

### Como ele roda

- **Início automático:** quando você entra no Windows, o atalho `agente-gaucho-whatsapp.vbs` da pasta Inicializar liga o gateway em segundo plano, sem janela.
- **Túnel:** ao iniciar, o gateway abre um Cloudflare Quick Tunnel e **registra a URL pública no app** (`POST /api/waha/register`, autenticado com a `WAHA_API_KEY`). A URL muda a cada reinício, e isso é tratado sozinho; não precisa mexer na Vercel.
- **Vigia do túnel:** se a internet cair, o túnel pode morrer mesmo com o `cloudflared` aberto. O gateway testa a própria URL pública a cada 60s e, depois de 3 falhas seguidas, recria o túnel e registra a URL nova no app. A recuperação leva até uns 3 minutos depois de a internet voltar.
- **Sessão do WhatsApp:** fica em `infra/wa-gateway/data/auth`. Reiniciar o PC não exige escanear o QR de novo. Se o número for desconectado pelo celular, o gateway apaga a sessão e o painel volta a pedir o QR.
- **Logs:** em `infra/wa-gateway/data/gateway.log`, um JSON por linha (eventos `tunnel.registered`, `session.status`, `webhook.delivered`…).

### Limitações e riscos

- **PC ligado:** com o PC desligado, dormindo ou sem internet, as mensagens desse número ficam sem resposta. O painel mostra o canal como inacessível.
- **Túnel gratuito:** o Quick Tunnel da Cloudflare não tem garantia de disponibilidade. Serve para começar; para algo estável, use uma VPS (seção abaixo).
- **Risco de bloqueio:** o canal usa o WhatsApp Web de forma não oficial, e o WhatsApp pode **bloquear o número** se perceber uso abusivo. Use um número que você aceite arriscar e não envie mensagens em massa. A API oficial não tem esse risco.
- **RAM do PC:** este PC tem 4,7 GB. Com muitas abas do Chrome abertas, o sistema pode ficar sem memória.

### Comandos úteis

```powershell
# Ligar manualmente (sem janela)
wscript "C:\Users\Brendo\Documents\DEV\agente-gaucho\infra\wa-gateway\start-hidden.vbs"

# Ver as últimas linhas do log
Get-Content "C:\Users\Brendo\Documents\DEV\agente-gaucho\infra\wa-gateway\data\gateway.log" -Tail 20

# Parar o gateway
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'gateway\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId }

# Desligar o início automático: Win+R → shell:startup → apague agente-gaucho-whatsapp.vbs
# Reinstalar o início automático:
powershell -File "C:\Users\Brendo\Documents\DEV\agente-gaucho\infra\wa-gateway\install-autostart.ps1"
```

### Instalar em outro PC

```bash
cd infra/wa-gateway
npm install
# .env (não versionado):
#   PORT=3000
#   WAHA_API_KEY=<mesma chave cadastrada na Vercel>
#   APP_URL=https://agente-gaucho.vercel.app
#   TUNNEL=cloudflared
#   CLOUDFLARED_BIN=C:/Program Files (x86)/cloudflared/cloudflared.exe
powershell -File install-autostart.ps1
```

O `cloudflared` é instalado com `winget install Cloudflare.cloudflared`.

## WhatsApp API oficial (Meta)

1. Gere o token permanente: business.facebook.com → **Usuários do sistema** → crie um usuário Admin → **Gerar token** com `whatsapp_business_messaging` e `whatsapp_business_management`, expiração **Nunca**. Depois atribua o App e a conta do WhatsApp a esse usuário.
2. Cadastre o token na Vercel como `META_SYSTEM_USER_TOKEN` e refaça o deploy.
3. No painel → **Canais WhatsApp**, copie a *Callback URL* e o *Verify token* para o App da Meta (WhatsApp → Configuration → Webhook), assine o campo `messages` e clique em **Conectar API oficial**.

Pela API oficial, responder ao cliente é grátis dentro de 24h da última mensagem dele. Mensagens iniciadas pela empresa são cobradas, e o agente nunca inicia conversa.

## Pastas

| Caminho | O quê |
|---|---|
| `apps/web` | App Next.js (painel + webhooks), vinculado ao projeto Vercel `agente-gaucho` |
| `apps/web/src/lib/channels` | Adapters: `waha.ts` (QR code) e `whatsapp-cloud.ts` (API oficial) |
| `apps/web/src/lib/intake.ts` | Entrada comum dos webhooks (filtro do atendente, rate limit, persistência) |
| `apps/web/src/lib/debounce.ts` | Agrupamento de mensagens (Redis + `after()`) |
| `apps/web/src/lib/flush.ts` | Decide e responde (regras, handoff, LLM, envio) |
| `apps/web/src/lib/llm` | Gemini, Groq, Anthropic e a cadeia de fallback |
| `apps/web/prisma` | Schema, migrações SQL e seed |
| `infra/wa-gateway` | Gateway WhatsApp por QR code para rodar no PC (em uso) |
| `infra/waha` | Alternativa: Waha + Caddy em VPS (não usada hoje) |
| `.secrets/` | Credenciais e chaves locais, **fora do git** |
| `setup.config.json` / `SPEC.md` | Decisões do setup wizard |

## Rodar o app localmente

```bash
cd apps/web
cp ../../.env.example .env.local     # preencha
npm install
npx prisma migrate deploy            # usa DATABASE_URL_UNPOOLED
npm run db:seed
npm run dev
```

> O build de produção (`next build`) precisa de mais RAM do que este PC tem livre. Faça o build pela Vercel (`vercel deploy --prod`).

## Deploy

O projeto Vercel está ligado ao GitHub (`FelipeSysten/agent-gaucho`, branch `main`). **Cada `git push` na `main` publica sozinho.**

```bash
# 1. Migração do banco, quando o schema mudar: do seu terminal, ANTES do push (nunca dentro do build)
cd apps/web && npx prisma migrate deploy

# 2. Publicar
git push origin main
```

- **Root Directory = `apps/web`** (Settings → Build and Deployment). O repositório tem várias pastas (`apps/web`, `infra/…`), e o app Next.js fica em `apps/web`. Com o Root Directory na raiz, a Vercel publica o repositório como site estático: o site fica em **404** e os arquivos do repositório passam a ser servidos publicamente. Foi o que aconteceu em 22/10, logo depois de ligar o GitHub.
- **Deploy manual pela CLI:** rode `vercel deploy --prod --archive=tgz` **na raiz do repositório**, não dentro de `apps/web`, porque a Vercel já entra em `apps/web` sozinha. O `--archive=tgz` envia um pacote único. Sem ele, a CLI ficou sem memória neste PC (4,7 GB de RAM).
- **Framework:** o `apps/web/vercel.json` fixa `"framework": "nextjs"`.
- **Variáveis de ambiente:** ficam na Vercel (`vercel env ls production`). `DATABASE_URL` e `DATABASE_URL_UNPOOLED` são injetadas pela integração da Neon.

## Alternativa: Waha em VPS

Use esta opção se quiser o canal QR 24h sem depender do PC. Os arquivos estão em `infra/waha`: Waha Core + Caddy com HTTPS automático via `sslip.io`, e o `setup.sh` instala tudo numa VM Ubuntu.

```bash
scp -r infra/waha ubuntu@<ip>:~/waha
ssh ubuntu@<ip> 'cd ~/waha && WAHA_API_KEY=<chave> bash setup.sh'   # imprime o WAHA_BASE_URL
```

Depois cadastre `WAHA_BASE_URL` na Vercel. Ele tem prioridade sobre a URL registrada pelo gateway do PC.

| Opção avaliada | Resultado |
|---|---|
| Oracle Cloud Always Free | Realmente grátis (inclui IP público), mas a VM não pôde ser criada |
| Google Cloud e2-micro | A VM é grátis, mas o IPv4 público custa cerca de US$ 3,65/mês |
| Render / Hugging Face grátis | Descartados: hibernam e perdem a sessão, exigindo novo QR |

## Limites conhecidos

- **Janela de 24h (só API oficial):** fora dela, só templates aprovados podem ser enviados. O aviso de handoff ao atendente tenta o canal da conversa e depois o outro. Como o QR code não tem janela, ele resolve esse caso.
- **Mensagens de mídia:** áudio, imagem e outros tipos viram texto descritivo (ex.: "[o cliente enviou um áudio]"). O agente não interpreta o conteúdo.
- **Debounce:** a função da Vercel fica viva durante a janela (`maxDuration = 60`).
- **Grupos:** mensagens de grupos, status e canais são ignoradas. O agente atende só conversas individuais.

## Notas desta máquina (Windows)

- **Virtualização:** a "Plataforma de Máquina Virtual" do Windows está **desativada**, por isso Docker Desktop e WSL não funcionam. Para ativar: PowerShell como administrador → `wsl.exe --install --no-distribution` → reiniciar.
- **Instalados pelo setup e em uso:**
  - Node.js
  - Vercel CLI (`npm i -g vercel`)
  - `neon` CLI (via `npx`)
  - `cloudflared` (winget)
  - `jq` (winget)
- **Removido:** o Google Cloud SDK foi instalado para avaliar o Google Cloud e depois desinstalado por completo (programa, entrada no registro e a pasta `%APPDATA%\gcloud`).
- **Logins ativos nas CLIs:** Vercel (`felipesysten`) e Neon (`systen3@gmail.com`). Para sair: `vercel logout` e `npx neon@latest profiles remove DEFAULT`.
