# Email Collection Builder

Web tool tạo email HTML từ một collection sản phẩm:

1. Dán URL collection.
2. Tool lấy đúng 9 sản phẩm đầu theo thứ tự hiển thị.
3. Tự lấy title, link và ảnh đầu tiên.
4. Tạo 4 subject gợi ý cùng preheader, headline và đoạn giới thiệu.
5. Cho phép sửa lại toàn bộ dữ liệu, xem preview và tải file HTML.

Template gốc Mailchimp đã được ghép từ ba phần người dùng cung cấp. Cấu trúc 1 sản phẩm nổi bật + 8 sản phẩm hai cột, logo, footer và unsubscribe được giữ nguyên.

## Chạy trên Netlify

1. Merge pull request vào nhánh main.
2. Trong Netlify, chọn Add new project → Import an existing project.
3. Chọn repository này.
4. Netlify tự đọc netlify.toml; không cần nhập build command.
5. Deploy.

Cấu hình đã có sẵn:

- Publish directory: public
- Functions directory: netlify/functions
- Node.js: 22

## Chạy thử trên máy

~~~bash
npm install
npx netlify dev
~~~

Sau đó mở URL do Netlify CLI hiển thị.

## Cách hoạt động

- public/index.html: giao diện nhập URL, sửa dữ liệu, preview và tải HTML.
- netlify/functions/generate.mjs: endpoint cào collection, kiểm tra URL và render email.
- netlify/functions/core.mjs: nhận diện sản phẩm, tạo copy và thay dữ liệu vào template.
- netlify/functions/email-template.html: template email hoàn chỉnh.
- tests/core.test.mjs: kiểm tra thứ tự 9 sản phẩm và quá trình thay template.

## Giới hạn hiện tại

- Hoạt động tốt nhất với collection có HTML sản phẩm sẵn trên máy chủ.
- Nếu website chỉ render sản phẩm bằng JavaScript, cần thêm adapter riêng hoặc trình duyệt headless.
- Bản 1.0 dùng ảnh gốc công khai của sản phẩm.
- Mockup kiểu Etsy cần thêm nơi lưu ảnh công khai như Cloudinary/S3; không nên nhúng ảnh local hoặc base64 vào email vì nhiều email client chặn chúng.
- Subject phải được nhập riêng trong Mailchimp, Klaviyo hoặc GMass khi tạo chiến dịch.

## Bảo mật

Backend từ chối localhost, IP riêng và các đích nội bộ để hạn chế SSRF. Mỗi lần chỉ đọc HTML công khai và không lưu dữ liệu collection.
