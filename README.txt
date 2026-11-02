# PokéImpostor Online (modo C)

Juego web multijugador de Pokémon con:
- salas privadas con código;
- búsqueda de partida pública (empareja con otra persona que esté buscando);
- elección secreta, preguntas sí/no, descarte, intento de adivinar y chat;
- tablero compartido de 24 Pokémon elegidos al azar entre los primeros 1.025.

## Para probarlo en tu PC (Windows 10/11)

1. Instalá Node.js LTS desde https://nodejs.org/
2. Descomprimí `PokeImpostor_Online.zip`.
3. Abrí la carpeta `PokeImpostor_Online`.
4. En la barra de dirección del Explorador escribí `cmd` y presioná Enter.
5. En la ventana negra ejecutá:
   ```
   npm install
   npm start
   ```
6. Abrí http://localhost:3000 en tu navegador.

`localhost` solo funciona en tu propia computadora. Para jugar con otra persona desde otra casa, hay que publicar esta carpeta en un hosting compatible con Node.js/WebSockets (por ejemplo, Render u otro servicio similar). Una vez publicado, ambos entran a la misma dirección web. El servidor debe mantenerse activo.

## Publicar online

Subí esta carpeta a un repositorio Git y creá un servicio web Node en un proveedor que admita WebSockets:
- Build command: `npm install`
- Start command: `npm start`
- No hace falta fijar un puerto: el servidor usa la variable `PORT` del proveedor.

Usá la URL HTTPS pública que te dé el proveedor para compartir el juego. La función de partidas públicas solo empareja jugadores que estén conectados al mismo servidor al mismo tiempo.

## Nota
Este proyecto es un prototipo inicial. Para facilitar el juego, la respuesta a las preguntas se basa en los datos que el cliente envía al servidor al elegir el Pokémon; no está diseñado para partidas competitivas contra trampas. El juego carga nombres, tipos e imágenes desde PokéAPI, por lo que requiere conexión a Internet. Fan game no oficial, sin afiliación con Nintendo, Game Freak ni The Pokémon Company.
