# Gato en línea

Juego del gato para dos jugadores en tiempo real con Node.js y Socket.IO.

- Cada jugador escribe su nombre y el servidor lo empareja con el siguiente jugador que esté esperando.
- La `X` y la `O` se reparten al azar. La `X` siempre abre.
- Los turnos se validan en el servidor: solo puede jugar quien tiene el turno.
- Al terminar se puede pedir revancha (se vuelven a sortear los símbolos) o buscar otro rival.
- Si un jugador se desconecta, el otro recibe un aviso.

## Correr en local

```bash
cd gato
npm install
npm start
```

Abre http://localhost:3000 en dos navegadores (o en dos pestañas) para jugar.

## Publicar

GitHub Pages solo sirve archivos estáticos y no puede correr el servidor de sockets.
Para jugar en línea, despliega la carpeta `gato` en un servicio que ejecute Node.js,
como Render, Railway o Fly.io, con el comando de inicio `npm start`. El puerto se toma de la variable `PORT`.
