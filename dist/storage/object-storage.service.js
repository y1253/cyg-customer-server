"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ObjectStorageService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ObjectStorageService = void 0;
const fs_1 = require("fs");
const common_1 = require("@nestjs/common");
const client_s3_1 = require("@aws-sdk/client-s3");
const lib_storage_1 = require("@aws-sdk/lib-storage");
let ObjectStorageService = ObjectStorageService_1 = class ObjectStorageService {
    logger = new common_1.Logger(ObjectStorageService_1.name);
    client = null;
    bucket;
    constructor() {
        const raw = (process.env.R2_BUCKET ||
            process.env.R2_BUCKET_NAME ||
            '').trim();
        if (raw && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(raw)) {
            throw new Error(`R2_BUCKET_NAME is "${raw}", which is not a bucket name (the endpoint is derived from R2_ACCOUNT_ID).`);
        }
        this.bucket = raw || null;
        if (!this.configured) {
            this.logger.warn('R2 is not configured — bookkeeping uploads will be refused.');
        }
    }
    get configured() {
        return Boolean(this.bucket &&
            process.env.R2_ACCOUNT_ID?.trim() &&
            process.env.R2_ACCESS_KEY_ID?.trim() &&
            process.env.R2_SECRET_ACCESS_KEY?.trim());
    }
    s3() {
        if (!this.configured)
            throw new Error('R2 is not configured');
        this.client ??= new client_s3_1.S3Client({
            region: 'auto',
            endpoint: `https://${process.env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`,
            forcePathStyle: true,
            credentials: {
                accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(),
                secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim(),
            },
            requestChecksumCalculation: 'WHEN_REQUIRED',
            responseChecksumValidation: 'WHEN_REQUIRED',
        });
        return this.client;
    }
    assertKey(key) {
        const bad = !key ||
            key !== key.trim() ||
            key.startsWith('/') ||
            key.includes('\\') ||
            key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..');
        if (bad)
            throw new Error(`Refusing a malformed storage key: "${key}"`);
    }
    async putFile(key, absolutePath, contentType) {
        this.assertKey(key);
        await new lib_storage_1.Upload({
            client: this.s3(),
            partSize: 8 * 1024 * 1024,
            queueSize: 4,
            params: {
                Bucket: this.bucket,
                Key: key,
                Body: (0, fs_1.createReadStream)(absolutePath),
                ContentType: contentType,
            },
        }).done();
    }
    async head(key) {
        this.assertKey(key);
        try {
            const res = await this.s3().send(new client_s3_1.HeadObjectCommand({ Bucket: this.bucket, Key: key }));
            return { size: res.ContentLength ?? 0 };
        }
        catch (err) {
            if (isNotFound(err))
                return null;
            throw err;
        }
    }
    async getStream(key) {
        this.assertKey(key);
        const res = await this.s3().send(new client_s3_1.GetObjectCommand({ Bucket: this.bucket, Key: key }));
        if (!res.Body)
            throw new Error(`R2 returned no body for "${key}"`);
        return res.Body;
    }
    async getBuffer(key) {
        const chunks = [];
        for await (const chunk of await this.getStream(key))
            chunks.push(chunk);
        return Buffer.concat(chunks);
    }
    async delete(key) {
        this.assertKey(key);
        await this.s3().send(new client_s3_1.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    }
};
exports.ObjectStorageService = ObjectStorageService;
exports.ObjectStorageService = ObjectStorageService = ObjectStorageService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [])
], ObjectStorageService);
function isNotFound(err) {
    const e = err;
    return (e?.$metadata?.httpStatusCode === 404 ||
        e?.name === 'NotFound' ||
        e?.name === 'NoSuchKey');
}
//# sourceMappingURL=object-storage.service.js.map