"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIRST_BOOK_NAME = void 0;
exports.listBooks = listBooks;
exports.ensureDefaultBook = ensureDefaultBook;
exports.ownBook = ownBook;
exports.businessBook = businessBook;
exports.companyBook = companyBook;
exports.legacyBook = legacyBook;
exports.bookOwnerName = bookOwnerName;
exports.createBook = createBook;
exports.renameBook = renameBook;
const common_1 = require("@nestjs/common");
const scope_1 = require("./scope");
exports.FIRST_BOOK_NAME = 'Company1';
const LIVE = { deletedAt: null };
async function listBooks(prisma, customerId) {
    await ensureDefaultBook(prisma, customerId);
    return prisma.book.findMany({
        where: { customerId, companyId: null, ...LIVE },
        orderBy: { id: 'asc' },
        select: { id: true, name: true, homeCurrency: true },
    });
}
async function ensureDefaultBook(prisma, customerId) {
    const found = await prisma.book.findFirst({
        where: { customerId, companyId: null, ...LIVE },
        orderBy: { id: 'asc' },
    });
    if (found)
        return (0, scope_1.bookScope)(found);
    const customer = await prisma.customer.findUnique({
        where: { id: customerId },
        select: { homeCurrency: true },
    });
    const created = await prisma.book.create({
        data: {
            customerId,
            name: exports.FIRST_BOOK_NAME,
            homeCurrency: customer?.homeCurrency ?? 'CAD',
        },
    });
    return (0, scope_1.bookScope)(created);
}
async function ownBook(prisma, customerId, bookId) {
    const book = await prisma.book.findFirst({
        where: { id: bookId, customerId, ...LIVE },
    });
    if (!book)
        throw new common_1.NotFoundException('Company not found');
    if (book.companyId !== null &&
        !(await liveCompany(prisma, customerId, book.companyId))) {
        throw new common_1.NotFoundException('Company not found');
    }
    return (0, scope_1.bookScope)(book);
}
async function businessBook(prisma, customerId, companyId) {
    const company = await liveCompany(prisma, customerId, companyId);
    if (!company)
        throw new common_1.NotFoundException('Business not found');
    return companyBook(prisma, company.id);
}
async function companyBook(prisma, companyId) {
    const found = await prisma.book.findUnique({ where: { companyId } });
    if (found)
        return (0, scope_1.bookScope)(found);
    const company = await prisma.company.findUnique({
        where: { id: companyId },
        select: { customerId: true, businessName: true, bookHomeCurrency: true },
    });
    if (!company?.customerId)
        throw new common_1.NotFoundException('Business not found');
    const created = await prisma.book.create({
        data: {
            customerId: company.customerId,
            companyId,
            name: company.businessName.slice(0, 120),
            homeCurrency: company.bookHomeCurrency,
        },
    });
    return (0, scope_1.bookScope)(created);
}
async function legacyBook(prisma, customerId, ref) {
    if (ref.bookId)
        return ownBook(prisma, customerId, ref.bookId);
    if (ref.companyId)
        return businessBook(prisma, customerId, ref.companyId);
    return ensureDefaultBook(prisma, customerId);
}
function liveCompany(prisma, customerId, companyId) {
    return prisma.company.findFirst({
        where: {
            id: companyId,
            customerId,
            isDraft: false,
            isInternal: false,
            deletedAt: null,
        },
        select: { id: true },
    });
}
async function bookOwnerName(prisma, scope) {
    const book = await prisma.book.findUnique({
        where: { id: scope.bookId },
        select: { name: true },
    });
    return book?.name ?? 'Your books';
}
async function createBook(prisma, customerId, name) {
    const clean = bookName(name);
    const first = await ensureDefaultBook(prisma, customerId);
    const home = await prisma.book.findUnique({
        where: { id: first.bookId },
        select: { homeCurrency: true },
    });
    return prisma.book.create({
        data: {
            customerId,
            name: clean,
            homeCurrency: home?.homeCurrency ?? 'CAD',
        },
        select: { id: true, name: true, homeCurrency: true },
    });
}
async function renameBook(prisma, customerId, bookId, name) {
    const clean = bookName(name);
    const book = await prisma.book.findFirst({
        where: { id: bookId, customerId, companyId: null, ...LIVE },
        select: { id: true },
    });
    if (!book)
        throw new common_1.NotFoundException('Company not found');
    return prisma.book.update({
        where: { id: book.id },
        data: { name: clean },
        select: { id: true, name: true, homeCurrency: true },
    });
}
function bookName(raw) {
    const name = raw.trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!name)
        throw new common_1.BadRequestException('Give the company a name');
    return name;
}
//# sourceMappingURL=books.js.map