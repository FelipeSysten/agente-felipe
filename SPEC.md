# SPEC — agente-felipe

> Adaptado do agente-gaucho (delivery) para o WhatsApp pessoal do Felipe: design, desenvolvimento e TI. As rotas de encaminhamento são **atendimento** ("falar com o Felipe") e **orcamento**; conversas pessoais recebem `[[IGNORAR]]`. O texto abaixo descreve a base técnica herdada.

## Caso de uso
Assistente de vendas/suporte que responde clientes e encaminha o **link de venda do delivery** · idioma pt-BR · volume baixo (até 10 conversas simultâneas)

## Canais habilitados
- WhatsApp Cloud API (Meta oficial)
- WhatsApp por QR code: gateway Node/Baileys no PC (`infra/wa-gateway`), com API compatível com o Waha e túnel da Cloudflare. Funciona só com o PC ligado.

Os dois funcionam juntos: cada cliente é respondido pelo canal por onde escreveu.

## Stack (custo zero)
| Peça | Serviço | Plano |
|---|---|---|
| App Next.js 16 + webhooks | Vercel (`agente-gaucho.vercel.app`) | Hobby (grátis) |
| Banco | Neon Postgres (Prisma 6) | Free |
| Debounce | Upstash Redis | Free |
| Login do painel | Auth.js magic link + Resend | Free (3.000 e-mails/mês) |
| WhatsApp (oficial) | Meta Cloud API | Respostas a clientes grátis |
| WhatsApp (QR code) | Gateway no PC + Cloudflare Quick Tunnel | Grátis |
| IA | Gemini → Groq → Anthropic | Free → Free → pago só se as grátis falharem |

- shadcn/ui "nova" · base zinc · radius 0.375rem · accent #adff2f (Alien Green) · dark por padrão
- Geist + Geist Mono
- Webhook da Meta: `https://agente-gaucho.vercel.app/api/webhooks/whatsapp-cloud`, com assinatura HMAC validada via `META_APP_SECRET`

## LLM
- Cadeia de fallback: `gemini-2.5-flash` (Google, grátis) → `openai/gpt-oss-120b` (Groq, grátis; o Llama 3.3 saiu do catálogo do Groq) → `claude-haiku-5-5` (Anthropic, pago e opcional)
- Os nomes dos modelos são validados contra a API de cada provedor no setup
- Memória: últimas 20 mensagens por contato

## Debounce de mensagens
- Ativo: sim
- Janela: 5000 ms
- Buffer máximo: 20 mensagens por contato
- Store: Upstash Redis (chave `debounce:<channel>:<contact>`)
- Runtime: `after()` do Next.js na Vercel, com fallback síncrono se o Redis falhar

## Tools habilitadas
Nenhuma. O link do delivery e as informações do negócio ficam no system prompt, editável em `/agents`.

## Handoff
Gatilho: pedido explícito do cliente ("falar com atendente") · Destino: o mesmo canal, notificando o número do atendente

## Horário
24/7 (America/Sao_Paulo)

## ⚠️ Avisos
- O Waha usa o WhatsApp Web de forma não oficial: a Meta pode bloquear o número em uso abusivo.
- Aviso ao atendente: o código tenta o canal da conversa e depois o outro. O Waha não tem janela de 24h.
- **Vercel Hobby não permite uso comercial** pelos termos da Vercel. Para operar o delivery de verdade, o caminho é o Pro ($20/mês).
- No Gemini gratuito, o Google pode usar as conversas para melhorar os produtos dele.
- Pela Cloud API, responder dentro de 24h depois da mensagem do cliente é grátis. Mensagens iniciadas pela empresa são cobradas, e o agente não inicia conversas.
- A Cloud API exige um número dedicado, que não pode estar em uso no app comum do WhatsApp.
- Em serverless, o debounce usa `after()` em vez de `setTimeout`.

## Desvios do wizard original (decididos no scaffold)
- **Login:** magic link próprio (token com hash no Postgres, cookie JWT `jose`, envio pela API do Resend), em vez do Auth.js v5, que ainda está em beta. O acesso fica restrito a `ADMIN_EMAILS`.
- **Chaves de API:** ficam em env vars da Vercel, não criptografadas no banco. O onboarding só mostra quais estão presentes.
- **`cacheComponents`:** desligado. O painel é todo dinâmico.
- **Regras de IA:** a semeada é o handoff por palavra-chave, editável em Configurações. O editor visual de regras ficou fora do MVP, mas o motor suporta todos os 7 modos.
- **Graph API:** `v24.0` (configurável via `META_GRAPH_VERSION`). A inscrição de webhooks é feita na WABA (`/{waba-id}/subscribed_apps`), não no phone number.

## Critérios de aceite
1. O webhook da Cloud API é verificado (GET) e recebe mensagens (POST com HMAC válido).
2. Três mensagens seguidas, com menos de 5s entre elas, no mesmo contato geram **1** resposta combinada em cerca de 5s + latência do LLM.
3. Com a chave do Gemini invalidada, a resposta vem do Groq. Sem as duas, vem da Anthropic, se estiver configurada.
4. Trocar o modelo no painel faz a próxima mensagem já usar o novo modelo.
5. Perguntar "quero fazer um pedido" faz o agente responder com o link do delivery configurado.
6. Ao pedir "falar com atendente", a IA pausa e o atendente é notificado; o botão "Reativar IA" funciona.
7. A Vercel serve `/api/health` com `{ok:true, db:true, redis:true}`.
