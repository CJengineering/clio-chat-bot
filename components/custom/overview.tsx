import { motion } from 'framer-motion';
import Image from 'next/image';
import Link from 'next/link';

import { JPalLogo, MessageIcon, VercelIcon } from './icons';

export const Overview = () => {
  return (
    <motion.div
      key="overview"
      className="max-w-3xl mx-auto md:mt-20"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ delay: 0.5 }}
    >
      <div className="rounded-xl p-6 flex flex-col gap-8 leading-relaxed text-center max-w-xl">
        <p className="flex flex-row justify-center gap-4 items-center">
          {/* <VercelIcon size={32} />
          <span>+</span>
          <MessageIcon size={100} /> */}
          <Image
            src="/images/JPAL_LOGO_SVG.svg"
            alt={'J-Pal logo'}
            width={300}
            height={300}
          />
        </p>
        <p>
          Jameel-CLIO is a domain knowledge specific chatbot focused on research
          conducted by the Abdul Latif Jameel Poverty Action Lab (J-PAL) since
          2003. The chatbot utilises OpenAI&lsquo;s ChatGPT 3.5 and adds a contextual
          corpus of hundreds of J-PAL research papers.
        </p>
        <p>
        You can learn more about J-CLIO by contacting us {' '}
          <Link
            className="font-medium underline underline-offset-4"
            href="https://www.communityjameel.org"
            target="_blank"
          >
            here
          </Link>
          .
        </p>
      </div>
    </motion.div>
  );
};
