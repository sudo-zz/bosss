// 用 macOS PDFKit 提取 PDF 文本（含分页），输出 JSON 到 stdout。
// 由 src/media/pdf_text.ts 在首次使用时编译到 ~/.boss-cli/bin/pdf-text。
//
// 用法：pdf-text <a.pdf> [b.pdf ...]
// 输出：[{ file, pageCount, pages: [{ index, text }], text, error }]
import Foundation
import PDFKit

struct PagePayload: Codable {
    let index: Int
    let text: String
}

struct DocPayload: Codable {
    let file: String
    let pageCount: Int
    let pages: [PagePayload]
    let text: String
    let error: String?
}

let files = Array(CommandLine.arguments.dropFirst())
if files.isEmpty {
    FileHandle.standardError.write("usage: pdf-text <a.pdf> [b.pdf ...]\n".data(using: .utf8)!)
    exit(2)
}

var docs: [DocPayload] = []
for file in files {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: file)) else {
        docs.append(DocPayload(file: file, pageCount: 0, pages: [], text: "", error: "无法打开 PDF"))
        continue
    }
    var pages: [PagePayload] = []
    for i in 0..<doc.pageCount {
        let text = doc.page(at: i)?.string ?? ""
        pages.append(PagePayload(index: i, text: text))
    }
    let joined = pages.map { $0.text }.joined(separator: "\n")
    docs.append(DocPayload(file: file, pageCount: doc.pageCount, pages: pages, text: joined, error: nil))
}

let encoder = JSONEncoder()
encoder.outputFormatting = [.withoutEscapingSlashes]
if let data = try? encoder.encode(docs), let out = String(data: data, encoding: .utf8) {
    print(out)
} else {
    FileHandle.standardError.write("encode failed\n".data(using: .utf8)!)
    exit(3)
}
