import Server from "./rest/Server";

const PORT = 4321;

const server = new Server(PORT);
server
	.start()
	.then(() => {
		console.log(`Server started on port ${PORT}`);
	})
	.catch((err) => {
		console.error(`Failed to start server: ${err}`);
		process.exit(1);
	});
