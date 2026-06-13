import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { APP_DESCRIPTION, APP_NAME, APP_NAME_SHORT } from "../../lib/branding";
import { login } from "../../shopify.server";

import styles from "./styles.module.css";

export function meta() {
  return [
    { title: APP_NAME },
    { name: "description", content: APP_DESCRIPTION },
  ];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>{APP_NAME}</h1>
        <p className={styles.text}>{APP_DESCRIPTION}</p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in to {APP_NAME_SHORT}
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Automatic sold-out sorting</strong>. Push sold-out products to
            the bottom of your manual collections without manual reordering.
          </li>
          <li>
            <strong>Smart restore</strong>. Return products to their original or
            top position when inventory is available again.
          </li>
          <li>
            <strong>Collection control</strong>. Enable push-down per collection
            and monitor activity from a single dashboard.
          </li>
        </ul>
      </div>
    </div>
  );
}
