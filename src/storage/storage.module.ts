import { Global, Module } from '@nestjs/common';
import { ObjectStorageService } from './object-storage.service';
import { PictureEnhancerService } from './picture-enhancer.service';

@Global()
@Module({
  providers: [ObjectStorageService, PictureEnhancerService],
  exports: [ObjectStorageService, PictureEnhancerService],
})
export class StorageModule {}
