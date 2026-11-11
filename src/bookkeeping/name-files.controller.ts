import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { unlink } from 'fs/promises';
import { CustomerJwtGuard } from '../customer-auth/customer-jwt.guard';
import { Book, BookScopeGuard } from './book-scope.guard';
import {
  ATTACHMENT_UPLOAD_OPTIONS,
  MAX_FILES_PER_REQUEST,
} from './attachment-uploads';
import { AttachmentsService, type AttachmentView } from './attachments.service';
import {
  AddNameDto,
  CreateNameFolderDto,
  PhoneUploadLinkDto,
  PlaceAttachmentDto,
  RenameNameFolderDto,
  WelcomeEmailDto,
} from './dto/name-files.dto';
import {
  NameFilesService,
  type AttachmentEmailView,
  type NameFolderView,
} from './name-files.service';
import type { BookScope } from './scope';
import { TaxService } from './tax.service';

/**
 * step2 (2026-11-11) — files live in the Names tab: move / rename a file, subfolders,
 * names added by hand, the email a file came in, the QR upload link, the welcome email.
 */
@Controller('bookkeeping')
@UseGuards(CustomerJwtGuard, BookScopeGuard)
export class NameFilesController {
  constructor(
    private readonly files: NameFilesService,
    private readonly attachments: AttachmentsService,
    private readonly tax: TaxService,
  ) {}

  @Patch('attachments/:id/place')
  place(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PlaceAttachmentDto,
  ): Promise<AttachmentView> {
    return this.attachments.place(scope, id, dto);
  }

  @Get('attachments/:id/email')
  email(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AttachmentEmailView> {
    return this.files.email(scope, id);
  }

  @Get('name-folders')
  folders(@Book() scope: BookScope): Promise<NameFolderView[]> {
    return this.files.folders(scope);
  }

  @Post('name-folders')
  createFolder(
    @Book() scope: BookScope,
    @Body() dto: CreateNameFolderDto,
  ): Promise<NameFolderView[]> {
    return this.files.createFolder(
      scope,
      dto.name ?? null,
      dto.parentId ?? null,
      dto.title,
    );
  }

  @Patch('name-folders/:id')
  renameFolder(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenameNameFolderDto,
  ): Promise<NameFolderView[]> {
    return this.files.renameFolder(scope, id, dto.title);
  }

  @Delete('name-folders/:id')
  removeFolder(
    @Book() scope: BookScope,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<NameFolderView[]> {
    return this.files.removeFolder(scope, id);
  }

  /** A name added by hand — listed from now on, with or without transactions. */
  @Post('names')
  async addName(
    @Book() scope: BookScope,
    @Body() dto: AddNameDto,
  ): Promise<{ name: string }> {
    return { name: await this.tax.addName(scope, dto.name, dto.group ?? null) };
  }

  @Post('phone-upload-link')
  phoneUploadLink(
    @Book() scope: BookScope,
    @Body() dto: PhoneUploadLinkDto,
  ): Promise<{ url: string; expiresInMinutes: number }> {
    return this.files.phoneUploadLink(scope, dto);
  }

  @Post('welcome-email')
  welcomeEmail(
    @Book() scope: BookScope,
    @Body() dto: WelcomeEmailDto,
  ): Promise<{ ok: boolean; message: string }> {
    return this.files.welcomeEmail(scope, dto.to);
  }
}

/**
 * step2 (2026-11-11): the page a phone opens from the QR code — no sign-in; the token in
 * the path names the customer, the book and where the files go (30 minutes).
 */
@Controller('phone-upload')
export class PhoneUploadController {
  constructor(
    private readonly files: NameFilesService,
    private readonly attachments: AttachmentsService,
  ) {}

  @Get(':token')
  async info(
    @Param('token') token: string,
  ): Promise<{ bookName: string; name: string | null }> {
    const t = await this.files.phoneUploadTarget(token);
    return { bookName: t.bookName, name: t.name };
  }

  @Post(':token')
  @UseInterceptors(
    FilesInterceptor('files', MAX_FILES_PER_REQUEST, ATTACHMENT_UPLOAD_OPTIONS),
  )
  async upload(
    @Param('token') token: string,
    @UploadedFiles() files: Express.Multer.File[],
  ): Promise<Array<{ id: number; filename: string }>> {
    if (!files?.length) throw new BadRequestException('Choose a file to add');
    const t = await this.files.phoneUploadTarget(token).catch(async (err) => {
      // The files are already staged on disk; `upload` would remove them, but it never runs.
      await Promise.all(files.map((f) => unlink(f.path).catch(() => undefined)));
      throw err;
    });
    const rows = await this.attachments.upload(t.scope, files, null, {
      name: t.name,
      folderId: t.folderId,
    });
    return rows.map((r) => ({ id: r.id, filename: r.filename }));
  }
}
