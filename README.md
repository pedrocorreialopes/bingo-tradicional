# Bingo 75 — Chamador Profissional

Chamador de bingo tradicional de 75 bolas, feito em HTML5, CSS3 e JavaScript puro. Funciona no navegador, inclusive offline, sem backend, instalação, bibliotecas, fontes ou recursos externos.

## Abrir e usar

1. Mantenha `index.html`, `style.css`, `script.js` e a pasta `js/` juntos.
2. Abra **`index.html`** diretamente em um navegador moderno.
3. Ajuste o intervalo e o modo automático em **Ajustes**, se necessário.
4. Clique em **Iniciar jogo**. Com o automático ligado, a primeira bola é sorteada imediatamente e as seguintes respeitam a contagem regressiva.
5. Use **Pausar**, **Continuar** ou **Sortear próxima bola** durante a partida.
6. Use **Pedra maior** em caso de empate, **Finalizar jogo** ao encerrar e **Modo telão** para projeção.

Não é necessário servidor HTTP. Os arquivos podem ser copiados para um pendrive ou pasta local e utilizados sem internet.

## Funcionalidades

- Tabuleiro oficial com 75 números únicos, nas colunas B (1–15), I (16–30), N (31–45), G (46–60) e O (61–75).
- Fisher–Yates com Web Crypto e rejeição de viés de módulo; fallback para navegadores antigos.
- Sorteio sem repetição, animação de urna, bola tridimensional e destaque da coluna correspondente.
- Sorteio automático ou manual; intervalos de 5, 8, 10, 15, 20, 30 segundos ou personalizado de 1 a 300 segundos.
- Pausa com preservação do tempo restante; sorteio manual durante a pausa mantém a partida pausada.
- Bola atual e anterior, últimas seis bolas, histórico completo em ordem de sorteio e estatísticas de progresso e tempo.
- Pedra Maior independente, com 2 a 100 participantes, remoção/adição, sorteio imparcial, vencedor em destaque e repetição confirmada.
- Efeitos sonoros sintetizados com Web Audio API, sem arquivos de áudio; volume e som configuráveis.
- Temas azul noturno, grafite e eclipse; animações e velocidade configuráveis.
- Modo telão responsivo e Fullscreen API, com retorno por botão ou `Esc`.
- Layout adaptado a computador, tablet, celular, televisão e projetor.
- Confirmações para novo jogo, finalização, restauração e repetição do desempate.

## Salvamento e recuperação

Os dados ficam somente no `localStorage` do navegador e da origem em que o arquivo foi aberto. Não há envio para servidores.

| Chave | Conteúdo |
|---|---|
| `bingo75.current.v1` | Partida atual, incluindo bolas sorteadas, ordem, deck restante, relógios, configurações da partida e desempate |
| `bingo75.backup.v1` | Cópia da partida substituída por novo jogo ou restauração |
| `bingo75.finished.v1` | Última partida finalizada |
| `bingo75.settings.v1` | Preferências persistentes do operador |
| `bingo75.tie.v1` | Participantes, vencedor e até 50 resultados recentes da Pedra Maior |

O salvamento ocorre após cada bola, ao pausar, continuar, finalizar, criar nova partida, recuperar e alterar configurações. Antes de substituir a partida atual, o sistema grava primeiro seu estado mais recente no backup. Uma falha nesse backup cancela a substituição.

Na abertura, a recuperação automática restaura a partida atual. Se ela estava em andamento ou em animação, retorna **pausada por segurança**: nenhuma bola é disparada sem ação do operador. A janela **Recuperar** permite escolher entre jogo atual, backup automático e último finalizado. Uma partida finalizada pode ser reaberta como pausada sem apagar o registro original finalizado.

**Importante:** dados locais são separados por navegador, perfil, dispositivo e origem. Limpar os dados do site/navegador pode apagar os backups. Use sempre a mesma cópia e o mesmo navegador durante um evento. Não use `localStorage.clear()` nem apague as chaves acima.

## Atalhos

- `Espaço`: iniciar ou sortear a próxima bola.
- `P`: pausar ou continuar.
- `F`: entrar ou sair do modo telão.
- `Esc`: sair do telão ou fechar diálogos, quando permitido.

Atalhos são ignorados enquanto o operador digita em um campo ou utiliza um diálogo.

## Estrutura

```text
index.html       Interface semântica, SVGs e diálogos
style.css        Design, bolas, responsividade, temas e modo telão
script.js        Interface, orquestração, configurações e Pedra Maior
js/engine.js     Sorteio, estado, validação, persistência e Web Audio
README.md        Documentação
```

## Verificações realizadas

A aplicação foi testada em navegador automatizado, acionando os controles reais e verificando os registros persistidos:

- exatamente 75 números únicos e válidos em uma partida completa;
- bloqueio de backup com bola duplicada;
- marcação do tabuleiro e histórico após o sorteio;
- pausa do intervalo e sorteio manual durante a pausa;
- retomada sem alteração do histórico;
- disparo automático após a contagem;
- recarga real preservando ID, ordem, deck e tabuleiro;
- confirmação e preservação ao finalizar;
- novo jogo com 75 bolas e manutenção dos backups;
- recuperação dos três registros e reabertura de partida finalizada;
- Pedra Maior com mínimo de dois nomes, vencedor, repetição confirmada e histórico principal inalterado;
- configurações personalizadas e tema persistentes;
- entrada e saída do modo telão;
- inspeções visuais da partida, recuperação, Pedra Maior, telão e layout móvel.

O modo telão visual funciona mesmo se o navegador bloquear a tela cheia. Fullscreen e áudio dependem de um gesto real do usuário, conforme as políticas do navegador.

## Publicação e pendências

- **Entrada:** `index.html`.
- **URL pública:** nenhuma; nenhuma publicação foi solicitada ou realizada.
- **Dependências externas:** nenhuma.
- **Pendências funcionais conhecidas:** nenhuma.

Para distribuir, basta copiar toda a pasta. Para publicar em uma URL, é necessária uma implantação explicitamente autorizada; isso não é necessário para o uso local/offline.
