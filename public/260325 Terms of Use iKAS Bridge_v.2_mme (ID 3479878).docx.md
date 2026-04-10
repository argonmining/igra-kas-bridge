 **iKAS Bridge Interface – Terms of Use**

Last updated: March 2026

**PREAMBLE**

Welcome to the user interface (“**User Interface**”) for the iKAS bridge (“**iKAS Bridge**”). The following terms of use (“**Terms**”) govern your access and use of the User Interface, including all related tools, web applications, smart contracts, and application programming interfaces (APIs) made available thereon. 

The operator of the User Interface (“**Interface Operator**”) reserves the right to modify or update these Terms at any time in its sole discretion. In such case, the “last updated” date above will be revised accordingly. By continuing to access or use the User Interface, you acknowledge and accept the Terms as updated from time to time. If you do not agree to these Terms, you must immediately cease all access to and use of the User Interface.

1. **Eligibility and Prohibited Jurisdictions**

By accessing or using the User Interface, you represent and warrant that you:

1) have the legal capacity and authority to accept and comply with these Terms;

2) are not prohibited from accessing or using the User Interface under any applicable laws or regulations;

3) are not subject to any sanctions or restrictive measures administered or enforced by the United Nations, the United States, the European Union, or the United Kingdom, and are not owned or controlled by, or acting on behalf of, any such person;

4) are not located in, organized, or resident in any jurisdiction that is subject to comprehensive sanctions or embargoes, including, without limitation, Cuba, Iran, North Korea, and Syria, or any region subject to comprehensive sanctions (including Crimea, Donetsk, or Luhansk) (“**Prohibited Jurisdictions**”); and

5) will not access or use the User Interface through any means intended to circumvent applicable restrictions, including through the use of VPNs, proxies, or similar technologies.

We reserve our right, at our sole discretion, to restrict or block access to the User Interface based on geographical location or other compliance-related criteria.

2. **iKAS Bridge**

   1. **Introduction and Overview**

The Kaspa network (“**Kaspa**”) is a decentralized proof-of-work blockchain designed to enable high-throughput and fast confirmation times. The native cryptocurrency of Kaspa is KAS (“**KAS**”), which is used for transactions and network security.

The Igra network (“**Igra Network**”) is a separate, EVM-compatible network built to enable smart contract functionality and decentralized applications in connection with Kaspa. To facilitate interactions between Kaspa and the Igra Network, a representation of KAS is made available on the Igra Network in the form of iKAS (“**iKAS**”). iKAS is a token on the Igra Network that is intended to represent a corresponding amount of KAS and may be used within protocol deployed on the Igra Network. 

2. **Minting of iKAS (Entry Transaction)**

The minting of iKAS on the Igra Network is triggered by user-initiated transactions on Kaspa that comply with the applicable technical requirements of the bridging mechanism (“**Entry Transaction**”). The Entry Transaction is processed in a permissionless manner and, upon detection by the Igra Network, may result in a corresponding increase of the user’s iKAS balance on the Igra Network.

The minting process is governed by the protocol-level rules of the Igra Network and relies on the underlying consensus of Kaspa. By using the User Interface, you acknowledge that the correct formation and submission of the Entry Transaction is your sole responsibility, and that failure to comply with the applicable technical requirements may result in delays, failed minting, or permanent loss of funds. Blockchain transactions are irreversible and cannot be undone once submitted.

The minting of iKAS is executed through decentralized network processes. Neither the Interface Operator nor any affiliated party has control over, or the ability to intervene in, the minting process once an Entry Transaction has been submitted, and no guarantee is given that any Entry Transaction will result in the minting of iKAS or that such minting will occur within any specific timeframe.

3. **Burning of iKAS (Exit Transaction)**

Users who wish to convert iKAS on the Igra Network into KAS on Kaspa may initiate a withdrawal process (“**Exit Transaction**”). Such process involves the reduction or burning of the user’s iKAS balance on the Igra Network and, subject to the applicable process, the release of a corresponding amount of KAS on Kaspa.

Due to the technical limitations of Kaspa, which does not support programmable smart contract logic for automated withdrawals, the exit process requires manual transaction construction and execution by a multi-signature mechanism controlled by independent signers. As a result, the processing of Exit Transactions is not instantaneous and may take several days or longer depending on network conditions, transaction volume, and operational factors. By using the User Interface to mint iKAS, you acknowledge and agree that:

* the processing of Exit Transactions is subject to delays and no guaranteed processing time or service level applies; 

* Exit Transactions may be delayed, limited, or not processed at all due to technical constraints, security considerations, or excessive demand;

* minimum and maximum withdrawal amounts may be imposed, and limits may apply to the number or frequency of Exit Transactions that are processed within a given period; and

* fees or commissions may be charged in connection with Exit Transactions.

  The availability and functioning of the exit process depend on the continued operation and coordination of independent network participants, including multi-signature signers, over which neither the Interface Operator nor any affiliated party has control or responsibility. 

  4. **Liability Waiver for iKAS Bridge**

The iKAS Bridge involves interactions with blockchain-based systems and smart contracts that are inherently subject to risks, including potential vulnerabilities, bugs, logic errors, or attacks that may result in partial or total loss of funds. By interacting with the iKAS Bridge, you do so at your own risk, fully understanding and accepting the inherent risks associated with minting and burning iKAS.

The iKAS Bridge and the User Interface are provided on an “as-is” and “as-available” basis, without any guarantees of availability, functionality, or performance. To the fullest extent permitted by applicable law, the Interface Operator disclaims liability for any loss or damages arising from or in connection with your use of the User Interface.

3. **User Interface Features**

   1. **Overview**

The User Interface serves as a graphical user interface that provides an easy way to interact with the iKAS Bridge as described herein. The Interface Operator reserves the right to remove features from the User Interface or to discontinue the operation of the User Interface in its entirety at any time without prior notice. 

2. **Programmatic Access (No Dependency on User Interface)**

As the iKAS Bridge is a permissionless protocol, it can be accessed by Users at any time via other user interfaces or by interacting directly with the protocol programmatically using any programming language or tooling, including but not limited to Rust, Python, or JavaScript. This means that its usability and accessibility does not depend on the Interface Operator or the availability of the User Interface. 

3. **Display of Network Information**

The User Interface may display publicly available information relating to Kaspa and the Igra Network (“**Network Information**”). The Network Information is automatically sourced via application programming interfaces (APIs) and displayed for informational purposes only. The Interface Operator does not assume any responsibility for the accuracy, completeness or timeliness of the Network Information and shall not be liable for any claims or damages related to errors, inaccuracies, or delays in the display of the Network Information or any decisions, transaction, acts or omissions that you make in reliance thereon.

4. **Interacting with iKAS Bridge**

   1. **Connecting Wallet to User Interface**

To interact with the iKAS Bridge via the User Interface, you must first connect one of the third-party wallets listed under the “Connect” tab (“**Wallet**”) to the User Interface. Wallets store and manage the private keys to the blockchain addresses that were created with the Wallet or manually imported into the Wallet. As these Wallets store the private keys which are required to sign transactions on-chain, they can be used to execute transactions and publish them to the Network. 

When you connect a Wallet, the User Interface will ask for permission to send Sign Requests (as defined in Section 3.4.2 below) to the Wallet. During this process, your Wallet will show the blockchain addresses managed by the Wallet that can be connected to the User Interface. You can modify these permissions at any time in the settings of the Wallet. Please note that you can only interact with blockchain addresses that are both managed by the Wallet and connected to the User Interface.

The use of Wallets is subject to the terms and conditions of the respective provider. The Interface Operator has no control over the blockchain addresses that are managed by the Wallet and connected to the User Interface and no ability to access any assets that are held thereon. You are solely responsible for the security of the Wallet as well as the corresponding private keys and passwords. The Interface Operator does not assume any responsibility for the connected Wallets, regardless of whether or not they are used to effectuate transactions and shall not be liable for any damages arising out of or related to your use of the Wallets or your inability to connect or use the Wallets to execute transactions.

2. **Sign Requests**

Once you have connected a Wallet to the User Interface, you can use the User Interface to initiate transactions from your blockchain address by generating standardized transaction messages (“**Sign Requests**”). Sign Requests that are generated on the User Interface are sent to the connected Wallet for approval. To complete the transaction, you must approve the Sign Request by signing the transaction with the connected Wallet. The User Interface will then display whether the transaction was successful.

Transactions that are signed with a Wallet are executed on Kaspa or the Igra Network without any involvement of the Interface Operator. The User Interface does not execute transactions on your behalf and does not control the execution of transactions initiated by you. You are fully responsible for all input you make while using the User Interface. 

3. **Transaction Fees**

All interactions with Kaspa, regardless of whether they are initiated on the User Interface, require the payment of transaction fees. The transaction fees required to execute a transaction depend on the activity on Kaspa and is entirely outside of the control of the Interface Operator. By using the User Interface to initiate transactions, you acknowledge and agree that transaction fees are non-refundable under any circumstances. 

5. **Third-Party Links**

The User Interface may contain links to websites and content that is controlled or operated by third parties ("**Third-Party Links**”). The Interface Operator provides these Third-Party Links for convenience only, and the inclusion of any Third-Party Links on the User Interface does not imply any endorsement by the Interface Operator of the Third-Party Links and/or their operators. The Interface Operator is not responsible for any content associated with the Third-Party Links.

If you believe that any Third-Party Links contain or promote illegal, harmful, fraudulent, infringing, obscene, defamatory, threatening, intimidating, harassing, hateful, racially, ethnically or otherwise objectionable content, please contact us via info@usecorn.com so that we can remove any such Third-Party Links from the User Interface.

4. **Intellectual Property Rights**

All rights, title, and interest in and to the User Interface, including all underlying software, design, content, trademarks, logos, and other intellectual property, are and shall remain the exclusive property of the Interface Operator or its licensors. Nothing in these Terms grants you any right, title, or interest in or to the User Interface, except for a limited, non-exclusive, non-transferable, and revocable right to access and use the User Interface solely for its intended purpose in accordance with these Terms. You shall not copy, modify, reproduce, distribute, reverse engineer, decompile, or otherwise attempt to derive the source code of the User Interface, except to the extent permitted by applicable law.

5. **Disclaimers and Limited Warranty**

The Interface Operator does not guarantee that the User Interface is free from defects, errors, bugs, and security vulnerabilities or that it will be available at any time. The access to and use of the User Interface is made at your own risk. The Interface Operator gives no assurance that any function of the User Interface will satisfy your requirements, provide the intended results, meet any performance or reliability standards. You understand and agree that the User Interface is provided on an “as is” and “as available” basis and that the Interface Operator expressly disclaims all warranties or conditions of any kind, whether express, implied, statutory or otherwise.

6. **Limitation of Liability**

To the fullest extent permitted by applicable law, the Interface Operator shall be liable only for direct damages caused by its wilful misconduct or gross negligence. Liability for any indirect, incidental, special, punitive, or consequential damages, including loss of profit or other economic loss, is excluded. This limitation of liability also applies to any use of the iKAS Bridge as described in Section 2\.

7. **Miscellaneous**

   1. **User Feedback**

The Interface Operator appreciates and encourages you to provide feedback to the User Interface. If you provide feedback, you agree that the Interface Operator is free to use it and may permit others to use it without any restriction or compensation to you.

2. **Tax Considerations**

It is your sole responsibility to seek relevant tax advice to comply with any applicable tax obligations in whichever jurisdiction and to measure the tax impact of the use of the User Interface and the use of the features offered thereon. 

3. **Entire Agreement and Severability**

These Terms contain the entire agreement between the Interface Operator and you regarding the subject matter hereof and supersedes all understandings and agreements whether written or oral.

If any provision of these Terms is invalid, illegal, or unenforceable in any jurisdiction, such invalidity, illegality, or unenforceability shall not affect any other provision of these Terms or invalidate or render unenforceable such provision in any other jurisdiction. Upon such determination that any provision is invalid, illegal, or unenforceable, these Terms shall be modified to effectuate the original intent of the parties as closely as possible. 

4. **Governing Law and Jurisdiction**

These Terms shall be construed and interpreted in accordance with the substantive laws of the Cayman Islands. Any dispute arising out of or in conjunction with these Terms shall be submitted to the exclusive jurisdiction of the ordinary courts of the Cayman Islands.

5. **Class Action Waiver**

To the fullest extent permitted by any applicable law, the User waives any right to participate in a class action lawsuit or a class-wide arbitration against the Interface Operator or any individual or entity involved in the operation of the User Interface.

8. **Contact**

Any questions related to these Terms can be sent to Kaspa Alliance for Transparency via email at legal@kat.foundation.

