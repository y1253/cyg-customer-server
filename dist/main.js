"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const common_1 = require("@nestjs/common");
const app_module_1 = require("./app.module");
const voice_gateway_1 = require("./voice/voice.gateway");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, {
        rawBody: true,
    });
    app.set('trust proxy', 1);
    app.enableCors({ origin: true, credentials: true });
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new common_1.ValidationPipe({ whitelist: true }));
    app.get(voice_gateway_1.VoiceGateway).attach(app.getHttpServer());
    const port = process.env.PORT ?? 3001;
    await app.listen(port);
    console.log(`Customer API running on http://localhost:${port}/api`);
}
void bootstrap();
//# sourceMappingURL=main.js.map