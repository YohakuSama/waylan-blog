/** A standalone privacy notice, separate from the personal About page. */
export default function Privacy() {
  return (
    <>
      <header className="page-heading">
        <p className="eyebrow mono">WAYLAN / PRIVACY</p>
        <h1 id="privacy-title">隐私说明</h1>
        <p>这里说明本站如何处理信息，以及你可以做出的选择。</p>
      </header>
      <article className="privacy-page about-prose" aria-labelledby="privacy-title">
        <p className="privacy-updated mono">
          最近更新：<time dateTime="2026-11-05">2026 年 11 月 5 日</time>
        </p>
        <p className="privacy-intro">
          你可以直接阅读本站公开内容，无需登录。使用 GitHub 登录、评论或通知功能时，
          本站才会处理相应的账号与互动信息。
        </p>

        <section aria-labelledby="privacy-usage">
          <h2 id="privacy-usage">访问与统计</h2>
          <p>
            本站不投放广告。站点由 Cloudflare 提供托管与网络安全服务，并使用
            Cloudflare Web Analytics 了解页面访问和加载表现。
          </p>
          <p>
            文章浏览量按日去重。服务端使用访问 IP、文章和日期生成哈希标记，
            用于计数的数据库不保存原始 IP 地址。Cloudflare 可能按其服务配置处理网络和安全日志。
          </p>
        </section>

        <section aria-labelledby="privacy-github">
          <h2 id="privacy-github">GitHub 登录与公开互动</h2>
          <p>
            登录由 GitHub App 提供授权。本站使用你的 GitHub 账号标识、
            用户名、头像及公开主页来识别账号和提供评论功能。
            实际授权权限以 GitHub 页面显示的内容为准。
          </p>
          <p>
            你发表的评论、回复与公开批注保存在 GitHub Discussions，
            对其他访客可见。请不要在公开互动中填写私人或敏感信息。
          </p>
        </section>

        <section aria-labelledby="privacy-browser">
          <h2 id="privacy-browser">本地数据与登录状态</h2>
          <p>
            外观设置、阅读偏好、阅读清单和私人划线保存在当前浏览器。
            这些私人记录不会作为公开评论上传。
          </p>
          <p>
            登录后本站使用安全会话 Cookie 保持登录状态。
            服务端保存会话标识的哈希，以及加密后的 GitHub 授权令牌，而非明文令牌。
          </p>
        </section>

        <section aria-labelledby="privacy-retention">
          <h2 id="privacy-retention">保存期限</h2>
          <p>
            登录会话最长约 7 天，临时授权状态最多 10 分钟；
            浏览量去重标记约保留 2 天，防止重复提交的记录约保留 90 天；
            开启通知时，通知记录约保留 180 天。
            这些到期记录由定时任务清理，实际删除可能稍有延迟。
            已公开的 GitHub 评论遵循 GitHub 的保存和删除机制。
          </p>
        </section>

        <section aria-labelledby="privacy-services">
          <h2 id="privacy-services">第三方服务</h2>
          <p>
            Cloudflare 负责站点托管、基础安全与网站分析；GitHub 负责登录授权与公开讨论。
            相关平台的数据处理方式以其各自的说明为准：
            <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Cloudflare 隐私政策</a>
            和
            <a href="https://docs.github.com/zh/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener noreferrer">GitHub 隐私声明</a>。
          </p>
        </section>

        <section aria-labelledby="privacy-choice">
          <h2 id="privacy-choice">你的选择与联系</h2>
          <p>
            你可以通过清除浏览器的本站数据来移除本地阅读记录，
            通过退出登录结束站内会话，或使用 GitHub 提供的功能编辑、删除自己发表的评论。
            清除浏览器数据不会自动删除 GitHub 上的公开评论。
          </p>
          <p>
            如需咨询本站保存的信息或提出访问、更正、删除请求，
            可查看<a href="https://github.com/YohakuSama" target="_blank" rel="noopener noreferrer">站长 GitHub 主页</a>提供的联系方式。
            请勿通过公开评论发送身份证件、Cookie 或访问令牌。
          </p>
        </section>
      </article>
    </>
  );
}
