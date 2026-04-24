import { Link } from "react-router-dom";

import { PageHeader } from "../components/layout/PageHeader";

export function NotFoundPage() {
  return (
    <div className="page-stack">
      <PageHeader
        title="页面不存在"
        description="当前路由不在本地控制台静态页面范围内。"
        eyebrow="兜底页"
      />
      <article className="panel panel--centered">
        <p>返回总览，继续使用当前已批准的本地控制台导航。</p>
        <Link className="inline-link" to="/">
          返回总览
        </Link>
      </article>
    </div>
  );
}
