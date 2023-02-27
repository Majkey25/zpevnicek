import Container from "../components/container";
import MoreStories from "../components/more-stories";
import Intro from "../components/intro";
import Layout from "../components/layout";
import { getSongsMetadata } from "../lib/get-songs-metadata";
import Head from "next/head";

export default function Index({ allPosts }) {
  return (
    <>
      <Layout>
        <Head>
          <title>STC Zpěvníček</title>
        </Head>
        <Container>
          <Intro />
          {allPosts.length > 0 && <MoreStories posts={allPosts} />}
        </Container>
      </Layout>
    </>
  );
}

export async function getStaticProps() {
  const allPosts = getSongsMetadata();
  return {
    props: { allPosts },
  };
}
